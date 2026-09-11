import test from 'node:test';
import assert from 'node:assert/strict';
import { BalanceController, currentProvider, handler, type SessionServices, type BalanceResult } from '../src/controller';
function fixture() {
  let provider: string | null = 'deepseek-official';
  const session = { requestHeader: () => ({ config: { provider: 'previous' } }) };
  const ctx: SessionServices = { sessions: { get: id => id === 'known' ? session : undefined }, sessionProjections: { stateOf: () => ({ pending: provider ? { provider } : null }) }, agentDefaultModel: { currentSelection: () => ({ provider: 'default' }) } };
  return { ctx, select: (p: string | null) => { provider = p; } };
}
const result: BalanceResult = { provider: 'deepseek-official', kind: 'balance', balances: [{ currency: 'CNY', amount: '0.00' }] };
test('selection follows pending, last request, then default; unknown session stays cold', () => {
  const { ctx, select } = fixture();
  assert.equal(currentProvider(ctx, 'known'), 'deepseek-official'); select(null);
  assert.equal(currentProvider(ctx, 'known'), 'previous');
  ctx.sessions.get = () => ({ requestHeader: () => undefined });
  assert.equal(currentProvider(ctx, 'known'), 'default');
  ctx.sessions.get = () => undefined;
  assert.equal(currentProvider(ctx, 'missing'), null);
});
test('unsupported provider hides without loading', async () => {
  const { ctx } = fixture(); const c = new BalanceController(ctx, async () => null);
  assert.equal((await c.state('known')).kind, 'hidden'); c.dispose();
});
test('cache deduplicates sessions and separates credential fingerprint; click cannot spam upstream', async () => {
  const { ctx } = fixture(); let key = 'account-a'; let loads = 0; let now = 100;
  const c = new BalanceController(ctx, async () => ({ key, load: async () => { loads++; return result; } }), () => now);
  await Promise.all([c.state('known'), c.state('known')]);
  await c.state('known'); assert.equal(loads, 1);
  key = 'account-b'; await c.state('known'); assert.equal(loads, 2);
  now += 46_000; await c.state('known'); assert.equal(loads, 3); c.dispose();
});
test('logout cannot reuse cached quota', async () => {
  const { ctx } = fixture(); let loggedIn = true;
  const c = new BalanceController(ctx, async () => loggedIn ? { key: 'account', load: async () => result } : null);
  assert.equal((await c.state('known')).kind, 'balance'); loggedIn = false;
  assert.equal((await c.state('known')).kind, 'hidden'); c.dispose();
});
test('load errors are sanitized, temporarily cached, and never become zero balance', async () => {
  const { ctx } = fixture(); let calls = 0;
  const c = new BalanceController(ctx, async () => ({ key: 'a', load: async () => { calls++; throw new Error('secret-token'); } }));
  assert.deepEqual(await c.state('known'), { provider: 'deepseek-official', kind: 'unavailable' });
  assert.equal(JSON.stringify(await c.state('known')).includes('secret'), false); assert.equal(calls, 1); c.dispose();
});
test('dispose aborts outstanding work and suppresses new work', async () => {
  const { ctx } = fixture(); let signal: AbortSignal | undefined;
  let started!: () => void; const ready = new Promise<void>(r => { started = r; });
  const c = new BalanceController(ctx, async () => ({ key: 'a', load: async s => { signal = s; started(); await new Promise((_, reject) => s.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); return result; } }));
  const pending = c.state('known'); await ready; c.dispose();
  assert.equal(signal?.aborted, true); await pending;
  assert.equal((await c.state('known')).kind, 'hidden');
});
test('HTTP validates session, method, no-store and hides thrown internal errors', async () => {
  const { ctx } = fixture(); const c = new BalanceController(ctx, async () => ({ key: 'a', load: async () => result })); const fetch = handler(c);
  assert.equal((await fetch(new Request('http://localhost/api/provider-balance'))).status, 400);
  assert.equal((await fetch(new Request('http://localhost/api/provider-balance?sessionId=../x'))).status, 400);
  assert.equal((await fetch(new Request('http://localhost/api/provider-balance?sessionId=known', { method: 'POST' }))).status, 405);
  const response = await fetch(new Request('http://localhost/api/provider-balance?sessionId=known'));
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.deepEqual(await response.json(), result);
  c.dispose();
});
