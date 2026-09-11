import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapterResolver, officialURL, parseCodex, parseDeepSeek, type AdapterServices } from '../src/adapters';
import { BalanceController } from '../src/controller';

const ACCESS = 'TEST-ONLY-access-secret';
const REFRESH = 'TEST-ONLY-refresh-secret';
const ACCOUNT = 'TEST-ONLY-account-private';
const API_KEY = 'TEST-ONLY-deepseek-secret';
const CODEX_KEY = 'llm-pi-ai/openai-codex';
const signal = () => new AbortController().signal;
const payload = (overrides = {}) => ({ type: 'oauth' as const, access: ACCESS, refresh: REFRESH, expires: Date.now() + 600_000, accountId: ACCOUNT, ...overrides });
const grant = (overrides = {}) => ({ kind: 'grant', payload: payload(overrides) });
const balance = { is_available: true, balance_infos: [{ currency: 'USD', total_balance: '12.3400', granted_balance: '2', topped_up_balance: '10.3400' }] };
const usage = { rate_limit: { primary_window: { used_percent: 20, limit_window_seconds: 18_000, reset_at: 1_800_000_000 }, secondary_window: { used_percent: 42.5, limit_window_seconds: 604_800 } } };
function fixture() {
  let stored: Awaited<ReturnType<AdapterServices['credentials']['readRecord']>> = grant();
  let tail: Promise<unknown> = Promise.resolve();
  let inLock = false;
  let writes = 0;
  const refs: string[] = [];
  const records: string[] = [];
  const settings: Record<string, unknown> = { 'llm-deepseek': {}, 'llm-pi-ai': {} };
  const env: Record<string, string> = {};
  const keys: Record<string, string> = { DEEPSEEK_API_KEY: API_KEY };
  const ctx: AdapterServices = {
    credentials: {
      async resolve(ref) { refs.push(ref); return keys[ref] ? { value: keys[ref] } : undefined; },
      async readRecord(key) { records.push(key); return stored; },
      modifyRecord(key, mutate) {
        records.push(key);
        const next = tail.then(async () => {
          inLock = true;
          try { const replacement = await mutate(stored); if (replacement !== undefined) { stored = replacement; writes++; } return stored; }
          finally { inLock = false; }
        });
        tail = next.catch(() => {});
        return next;
      },
    },
    settings: { get(ns) { return settings[ns]; } },
    get() { return { get(name) { return env[name] === undefined ? undefined : { value: env[name] }; } }; },
  };
  return { ctx, settings, env, keys, refs, records, setRecord(next: typeof stored) { stored = next; }, getRecord: () => stored, inLock: () => inLock, writes: () => writes };
}
function fetchMock(body: unknown = usage) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url, init) => { calls.push({ url: String(url), init: init ?? {} }); return Response.json(body); }) as typeof fetch;
  return { fn, calls };
}
async function deepTarget(fetcher: typeof fetch) {
  const f = fixture();
  const target = await adapterResolver(f.ctx, fetcher)('deepseek-official');
  assert.ok(target);
  return target;
}
function noSecrets(value: unknown) {
  const json = JSON.stringify(value);
  for (const secret of [ACCESS, REFRESH, ACCOUNT, API_KEY]) assert.equal(json.includes(secret), false, `public result exposed ${secret}`);
}

test('official URL accepts only declared HTTPS origin and exact normalized API paths', () => {
  for (const url of ['https://api.deepseek.com', 'https://api.deepseek.com/', 'https://api.deepseek.com/v1', 'https://api.deepseek.com/v1/']) assert.equal(officialURL(url, 'https://api.deepseek.com', ['', '/v1']), true, url);
  for (const url of [undefined, null, 5, '', 'not-url', 'http://api.deepseek.com', 'https://api.deepseek.com.evil.test', 'https://api.deepseek.com@evil.test', 'https://user:pass@api.deepseek.com', 'https://api.deepseek.com:444', 'https://api.deepseek.com/v2', 'https://api.deepseek.com/v1/models', 'https://api.deepseek.com/?key=x', 'https://api.deepseek.com/#x']) assert.equal(officialURL(url, 'https://api.deepseek.com', ['', '/v1']), false, String(url));
  assert.equal(officialURL('https://chatgpt.com/backend-api/', 'https://chatgpt.com', ['/backend-api']), true);
  assert.equal(officialURL('https://chatgpt.com/', 'https://chatgpt.com', ['/backend-api']), false);
});

test('DeepSeek keeps independent currencies, precise decimal strings and only approved leaves', () => {
  const before = Date.now();
  const out = parseDeepSeek({ ...balance, access: ACCESS, balance_infos: [...balance.balance_infos, { currency: 'CNY', total_balance: '-0.001', secret: REFRESH }] });
  assert.equal(out.kind, 'balance');
  assert.deepEqual(out.balances, [{ currency: 'USD', amount: '12.3400' }, { currency: 'CNY', amount: '-0.001' }]);
  assert.ok(out.updatedAt! >= before);
  noSecrets(out);
});

test('DeepSeek rejects absent/empty/malformed containers', () => {
  for (const input of [null, [], {}, { balance_infos: null }, { balance_infos: {} }, { balance_infos: [] }, { balance_infos: [null, {}, []] }]) assert.throws(() => parseDeepSeek(input), /Invalid balance/);
});

test('DeepSeek ignores invalid monetary rows but never silently manufactures a balance', () => {
  const invalid = [NaN, Infinity, 3, null, '', ' 1 ', 'NaN', 'Infinity', '1e6', '.5', '5.', '1,000', '9'.repeat(400)];
  for (const amount of invalid) assert.throws(() => parseDeepSeek({ balance_infos: [{ currency: 'USD', total_balance: amount }] }));
  const result = parseDeepSeek({ balance_infos: [{ currency: 'usd', total_balance: '9' }, { currency: '<x>', total_balance: '2' }, ...balance.balance_infos] });
  assert.deepEqual(result.balances, [{ currency: 'USD', amount: '12.3400' }]);
});

test('Codex calculates remaining percentages and converts epoch seconds to milliseconds', () => {
  const out = parseCodex({ ...usage, access_token: ACCESS, credits: { balance: REFRESH }, account_id: ACCOUNT });
  assert.equal(out.kind, 'quota');
  assert.deepEqual(out.windows, [{ label: '5h', remainingPercent: 80, resetsAt: 1_800_000_000_000 }, { label: '周', remainingPercent: 57.5 }]);
  noSecrets(out);
});

test('Codex identifies duration rather than primary/secondary position, sorts and deduplicates', () => {
  const week = { used_percent: 5, limit_window_seconds: 604_800 };
  const five = { used_percent: 100, limit_window_seconds: 18_000 };
  assert.deepEqual(parseCodex({ rate_limit: { primary_window: week } }).windows, [{ label: '周', remainingPercent: 95 }]);
  assert.deepEqual(parseCodex({ rate_limit: { primary_window: week, secondary_window: five } }).windows?.map(w => w.label), ['5h', '周']);
  assert.equal(parseCodex({ rate_limit: { primary_window: week, secondary_window: week } }).windows?.length, 1);
});

test('Codex missing/unrecognized windows hide instead of pretending zero quota', () => {
  for (const input of [null, [], {}, { rate_limit: null }, { rate_limit: { primary_window: null } }, { rate_limit: { primary_window: { used_percent: 1, limit_window_seconds: 1000 } } }]) assert.deepEqual(parseCodex(input), { provider: 'openai-codex', kind: 'hidden' });
  for (const used_percent of [null, undefined, '20', NaN, Infinity, -1]) assert.equal(parseCodex({ rate_limit: { primary_window: { used_percent, limit_window_seconds: 18_000 } } }).kind, 'hidden');
});

test('Codex caps overage at zero remaining and omits invalid reset times', () => {
  for (const reset_at of [undefined, 0, -1, NaN, Infinity, Number.MAX_VALUE, 8.64e12 + 1, '1800000000']) {
    assert.deepEqual(parseCodex({ rate_limit: { primary_window: { used_percent: 123, limit_window_seconds: 18_000, reset_at } } }).windows, [{ label: '5h', remainingPercent: 0 }]);
  }
});

test('unknown providers do not inspect credentials or make network requests', async () => {
  const f = fixture(); const m = fetchMock();
  assert.equal(await adapterResolver(f.ctx, m.fn)('custom-deepseek'), null);
  assert.deepEqual(f.refs, []); assert.deepEqual(f.records, []); assert.deepEqual(m.calls, []);
});

test('DeepSeek uses current resolved key reference and fixed official endpoint without leaking credentials', async () => {
  const f = fixture(); const m = fetchMock(balance);
  f.settings['llm-deepseek'] = { apiKeyEnv: 'SPECIAL_KEY', baseURL: 'https://api.deepseek.com/v1' };
  f.keys.SPECIAL_KEY = API_KEY;
  const target = await adapterResolver(f.ctx, m.fn)('deepseek-official'); assert.ok(target);
  assert.deepEqual(f.refs, ['SPECIAL_KEY']); assert.match(target.key, /^[a-f0-9]{64}$/); noSecrets({ key: target.key });
  const s = signal(); const result = await target.load(s); noSecrets(result);
  assert.equal(m.calls[0].url, 'https://api.deepseek.com/user/balance');
  assert.equal(m.calls[0].init.redirect, 'error'); assert.equal(m.calls[0].init.signal, s);
  assert.equal(new Headers(m.calls[0].init.headers).get('Authorization'), `Bearer ${API_KEY}`);
});

test('DeepSeek refuses missing registration, custom configured backend and ambient custom backend before resolving key', async () => {
  for (const configure of [(f: ReturnType<typeof fixture>) => { delete f.settings['llm-deepseek']; }, (f: ReturnType<typeof fixture>) => { f.settings['llm-deepseek'] = { baseURL: 'https://gateway.test' }; }, (f: ReturnType<typeof fixture>) => { f.env.DEEPSEEK_BASE_URL = 'https://gateway.test'; }]) {
    const f = fixture(); configure(f); const m = fetchMock();
    assert.equal(await adapterResolver(f.ctx, m.fn)('deepseek-official'), null);
    assert.deepEqual(f.refs, []); assert.deepEqual(m.calls, []);
  }
});

test('DeepSeek explicit official URL wins over ambient backend; key changes alter fingerprint', async () => {
  const f = fixture(); const m = fetchMock(balance); f.env.DEEPSEEK_BASE_URL = 'https://gateway.test';
  f.settings['llm-deepseek'] = { baseURL: 'https://api.deepseek.com' };
  const resolve = adapterResolver(f.ctx, m.fn); const a = await resolve('deepseek-official'); assert.ok(a);
  f.keys.DEEPSEEK_API_KEY = 'TEST-ONLY-rotated-key';
  const b = await resolve('deepseek-official'); assert.ok(b);
  assert.notEqual(a.key, b.key); assert.equal(f.refs.length, 2);
});

test('DeepSeek missing credential errors without attempting network', async () => {
  const f = fixture(); const m = fetchMock(); delete f.keys.DEEPSEEK_API_KEY;
  await assert.rejects(adapterResolver(f.ctx, m.fn)('deepseek-official'), /Missing credential/);
  assert.deepEqual(m.calls, []);
});

test('Codex hides custom key, protocol and backend routes without reading OAuth', async () => {
  for (const options of [{ apiKeyEnv: 'CUSTOM' }, { apiKeyEnv: '' }, { api: 'openai-responses' }, { protocol: 'openai-responses' }, { headers: { Authorization: 'Bearer custom', 'ChatGPT-Account-Id': 'custom-account' } }, { baseURL: 'https://gateway.test/backend-api' }, { baseURL: 'https://chatgpt.com/wrong' }, { baseURL: 'https://chatgpt.com/backend-api?secret=x' }]) {
    const f = fixture(); const m = fetchMock(); f.settings['llm-pi-ai'] = { providers: { 'openai-codex': options } };
    assert.equal(await adapterResolver(f.ctx, m.fn)('openai-codex'), null);
    assert.deepEqual(f.records, []); assert.deepEqual(m.calls, []);
  }
});

test('Codex accepts empty headers materialized by settings and queries both quota windows', async () => {
  const f = fixture(); const m = fetchMock();
  f.settings['llm-pi-ai'] = { providers: { 'openai-codex': { headers: {}, defaultMaxTokens: 32768 } } };
  const target = await adapterResolver(f.ctx, m.fn)('openai-codex');
  assert.ok(target, 'an empty headers map must not hide an authenticated subscription');
  const result = await target.load(signal());
  assert.equal(result.kind, 'quota');
  assert.deepEqual(result.windows?.map(w => w.label), ['5h', '周']);
  assert.equal(m.calls.length, 1); noSecrets(result);
});

test('Codex still hides nonempty and malformed header overrides', async () => {
  for (const headers of [{ authorization: 'secret' }, { 'chatgpt-account-id': 'other' }, null, [], 'bad', 1]) {
    const f = fixture(); const m = fetchMock();
    f.settings['llm-pi-ai'] = { providers: { 'openai-codex': { headers } } };
    assert.equal(await adapterResolver(f.ctx, m.fn)('openai-codex'), null);
    assert.equal(m.calls.length, 0); assert.equal(f.records.length, 0);
  }
});

test('Codex requires a well-formed native OAuth grant, never API-key or unrelated billing', async () => {
  for (const record of [undefined, { kind: 'api-key', key: API_KEY }, { kind: 'grant', payload: null }, grant({ type: 'api_key' }), grant({ access: '' }), grant({ refresh: '' }), grant({ accountId: '' }), grant({ expires: Infinity }), grant({ expires: '100' })]) {
    const f = fixture(); f.setRecord(record); const m = fetchMock();
    assert.equal(await adapterResolver(f.ctx, m.fn)('openai-codex'), null);
    assert.deepEqual(m.calls, []); assert.ok(f.records.every(x => x === CODEX_KEY));
  }
});

test('Codex uses native account and fresh token server-side and forwards restrictive fetch options', async () => {
  const f = fixture(); const m = fetchMock();
  f.settings['llm-pi-ai'] = { providers: { 'openai-codex': { baseURL: 'https://chatgpt.com/backend-api/' } } };
  const refresh = async () => { assert.fail('unexpired token must not refresh'); return payload(); };
  const target = await adapterResolver(f.ctx, m.fn, refresh)('openai-codex'); assert.ok(target);
  noSecrets({ key: target.key }); assert.match(target.key, /^[a-f0-9]{64}$/);
  const s = signal(); noSecrets(await target.load(s));
  assert.equal(m.calls[0].url, 'https://chatgpt.com/backend-api/wham/usage');
  assert.equal(m.calls[0].init.redirect, 'error'); assert.equal(m.calls[0].init.signal, s);
  const headers = new Headers(m.calls[0].init.headers);
  assert.equal(headers.get('Authorization'), `Bearer ${ACCESS}`); assert.equal(headers.get('ChatGPT-Account-Id'), ACCOUNT); assert.equal(headers.get('Accept'), 'application/json');
  assert.equal(f.writes(), 0);
});

test('Codex account changes and logout between resolution and load stop fetch', async () => {
  for (const next of [undefined, grant({ accountId: 'another-account' })]) {
    const f = fixture(); const m = fetchMock(); const target = await adapterResolver(f.ctx, m.fn)('openai-codex'); assert.ok(target);
    f.setRecord(next); await assert.rejects(target.load(signal()), /Credential changed/); assert.deepEqual(m.calls, []);
  }
});

test('Codex re-reads access token at load and fingerprints new account/token at next resolution', async () => {
  const f = fixture(); const m = fetchMock(); const resolve = adapterResolver(f.ctx, m.fn);
  const a = await resolve('openai-codex'); assert.ok(a);
  f.setRecord(grant({ access: 'rotated-access' }));
  await a.load(signal()); assert.equal(new Headers(m.calls[0].init.headers).get('Authorization'), 'Bearer rotated-access');
  const b = await resolve('openai-codex'); assert.ok(b); assert.notEqual(a.key, b.key);
  f.setRecord(grant({ accountId: 'other-account' }));
  const c = await resolve('openai-codex'); assert.ok(c); assert.notEqual(b.key, c.key);
});

test('Codex refresh executes exclusively inside native modifyRecord lock and persists rotated grant', async () => {
  const f = fixture(); const m = fetchMock(); f.setRecord(grant({ expires: 1 })); let count = 0;
  const refresh = async (current: ReturnType<typeof payload>, s: AbortSignal) => { assert.ok(f.inLock()); assert.equal(current.refresh, REFRESH); assert.equal(s.aborted, false); count++; return payload({ access: 'rotated-access', refresh: 'rotated-refresh' }); };
  const resolve = adapterResolver(f.ctx, m.fn, refresh); const a = await resolve('openai-codex'); const b = await resolve('openai-codex'); assert.ok(a); assert.ok(b);
  await Promise.all([a.load(signal()), b.load(signal())]);
  assert.equal(count, 1, 'concurrent stale reads must not rotate the same refresh token twice');
  assert.equal(f.writes(), 1, 'a second lock holder seeing fresh credentials must not rewrite them');
  assert.equal((f.getRecord()?.payload as ReturnType<typeof payload>).refresh, 'rotated-refresh');
  assert.equal(m.calls.length, 2);
  for (const call of m.calls) assert.equal(new Headers(call.init.headers).get('Authorization'), 'Bearer rotated-access');
});

test('Codex refreshed JWT changing account is rejected before commit and usage', async () => {
  const f = fixture(); const m = fetchMock(); const original = grant({ expires: 1 }); f.setRecord(original);
  const target = await adapterResolver(f.ctx, m.fn, async () => payload({ accountId: 'unexpected-new-account' }))('openai-codex'); assert.ok(target);
  await assert.rejects(target.load(signal()), /Credential changed/);
  assert.equal(f.getRecord(), original); assert.equal(f.writes(), 0); assert.deepEqual(m.calls, []);
});

test('Codex account change discovered only under refresh lock suppresses refresh and usage', async () => {
  const f = fixture(); const m = fetchMock(); f.setRecord(grant({ expires: 1 })); let refreshed = false;
  const originalModify = f.ctx.credentials.modifyRecord;
  f.ctx.credentials.modifyRecord = (key, mutate) => { f.setRecord(grant({ accountId: 'changed-while-waiting', expires: 1 })); return originalModify(key, mutate); };
  const target = await adapterResolver(f.ctx, m.fn, async () => { refreshed = true; return payload(); })('openai-codex'); assert.ok(target);
  await assert.rejects(target.load(signal()), /Credential changed/);
  assert.equal(refreshed, false); assert.deepEqual(m.calls, []);
});

test('Codex failed refresh preserves the stored grant and does not call usage', async () => {
  const f = fixture(); const m = fetchMock(); const original = grant({ expires: 1 }); f.setRecord(original);
  const target = await adapterResolver(f.ctx, m.fn, async () => { throw new Error('TEST upstream failure'); })('openai-codex'); assert.ok(target);
  await assert.rejects(target.load(signal())); assert.equal(f.getRecord(), original); assert.equal(f.writes(), 0); assert.deepEqual(m.calls, []);
});

test('Codex already-aborted signal suppresses refresh and usage', async () => {
  for (const expires of [1, Date.now() + 600_000]) {
    const f = fixture(); const m = fetchMock(); f.setRecord(grant({ expires })); let refreshed = false;
    const target = await adapterResolver(f.ctx, m.fn, async () => { refreshed = true; return payload(); })('openai-codex'); assert.ok(target);
    const abort = new AbortController(); abort.abort(); await assert.rejects(target.load(abort.signal));
    assert.equal(refreshed, false); assert.deepEqual(m.calls, []);
  }
});

test('provider HTTP failures discard/cancel body and never embed upstream content', async () => {
  for (const status of [302, 401, 403, 429, 500]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(ACCESS)); }, cancel() { cancelled = true; } });
    const target = await deepTarget((async () => new Response(body, { status })) as typeof fetch);
    await assert.rejects(target.load(signal()), error => { assert.equal((error as Error).message, 'Provider request failed'); noSecrets({ message: (error as Error).message }); return true; });
    assert.equal(cancelled, true);
  }
});

test('provider body parsing rejects empty and malformed bodies with generic errors', async () => {
  const empty = await deepTarget((async () => new Response(null)) as typeof fetch);
  await assert.rejects(empty.load(signal()), /Empty provider response/);
  const malformed = await deepTarget((async () => new Response(`not json ${ACCESS}`)) as typeof fetch);
  await assert.rejects(malformed.load(signal()), error => { assert.equal((error as Error).message, 'Invalid provider response'); noSecrets({ message: (error as Error).message }); return true; });
});

test('provider body cap is measured over streamed chunks and cancels on overflow', async () => {
  let cancelled = false;
  // Keep the source open: an already-closed source correctly receives no cancel callback.
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(100_000)); }, cancel() { cancelled = true; } });
  const target = await deepTarget((async () => new Response(body)) as typeof fetch);
  await assert.rejects(target.load(signal()), /Oversized provider response/); assert.equal(cancelled, true);
});

test('provider valid JSON exactly at byte limit is accepted', async () => {
  const json = JSON.stringify(balance); const padded = json + ' '.repeat(256_000 - Buffer.byteLength(json));
  const target = await deepTarget((async () => new Response(padded)) as typeof fetch);
  assert.equal((await target.load(signal())).kind, 'balance');
});

test('browser-facing controller sanitizes raw native refresh/network errors containing secret values', async () => {
  const f = fixture(); f.setRecord(grant({ expires: 1 }));
  const resolve = adapterResolver(f.ctx, (async () => { throw new Error(ACCESS); }) as typeof fetch, async () => { throw new Error(`upstream token response ${ACCESS} ${REFRESH} ${ACCOUNT}`); });
  const session = { requestHeader: () => ({ config: { provider: 'openai-codex' } }) };
  const controller = new BalanceController({ sessions: { get: () => session }, sessionProjections: { stateOf: () => ({ pending: null }) }, agentDefaultModel: { currentSelection: () => ({ provider: 'openai-codex' }) } }, resolve);
  try { const result = await controller.state('test-session'); assert.deepEqual(result, { provider: 'openai-codex', kind: 'unavailable' }); noSecrets(result); }
  finally { controller.dispose(); }
});
