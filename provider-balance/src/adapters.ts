import { createHash } from 'node:crypto';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import type { BalanceResult, Target } from './controller';

type RecordValue = { kind: string; payload?: unknown };
interface Grant { type: 'oauth'; access: string; refresh: string; expires: number; accountId: string }
export interface AdapterServices {
  credentials: {
    resolve(ref: string): Promise<{ value: string } | undefined>;
    readRecord(key: string): Promise<RecordValue | undefined>;
    modifyRecord(key: string, mutate: (current: RecordValue | undefined) => Promise<RecordValue | undefined>): Promise<RecordValue | undefined>;
  };
  settings: { get(ns: string): unknown };
  get(name: 'launchEnvironment'): { get(name: string): { value: string } | undefined } | undefined;
}
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const hash = (...values: string[]) => createHash('sha256').update(values.join('\0')).digest('hex');
const CODEX_KEY = 'llm-pi-ai/openai-codex';
function grant(record: RecordValue | undefined): Grant | null {
  if (record?.kind !== 'grant') return null;
  const p = object(record.payload);
  return p.type === 'oauth' && typeof p.access === 'string' && !!p.access && typeof p.refresh === 'string' && !!p.refresh && typeof p.accountId === 'string' && !!p.accountId && typeof p.expires === 'number' && Number.isFinite(p.expires)
    ? { type: 'oauth', access: p.access, refresh: p.refresh, accountId: p.accountId, expires: p.expires } : null;
}
export function officialURL(value: unknown, origin: string, paths: readonly string[]): boolean {
  if (typeof value !== 'string') return false;
  try { const u = new URL(value); return u.origin === origin && !u.username && !u.password && !u.search && !u.hash && paths.includes(u.pathname.replace(/\/+$/, '')); }
  catch { return false; }
}
export function parseDeepSeek(value: unknown): BalanceResult {
  const items = object(value).balance_infos;
  if (!Array.isArray(items)) throw new Error('Invalid balance');
  const balances: { currency: string; amount: string }[] = [];
  for (const item of items) {
    const row = object(item);
    if (typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency) || typeof row.total_balance !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(row.total_balance) || !Number.isFinite(Number(row.total_balance))) continue;
    balances.push({ currency: row.currency, amount: row.total_balance });
  }
  if (!balances.length) throw new Error('Invalid balance');
  return { provider: 'deepseek-official', kind: 'balance', balances, updatedAt: Date.now() };
}
export function parseCodex(value: unknown): BalanceResult {
  const limits = object(object(value).rate_limit);
  const windows: NonNullable<BalanceResult['windows']> = [];
  for (const raw of [limits.primary_window, limits.secondary_window]) {
    const w = object(raw);
    const seconds = w.limit_window_seconds;
    const label = seconds === 18_000 ? '5h' : seconds === 604_800 ? '周' : null;
    if (!label || typeof w.used_percent !== 'number' || !Number.isFinite(w.used_percent) || w.used_percent < 0) continue;
    const remainingPercent = Math.max(0, Math.min(100, 100 - w.used_percent));
    const resetsAt = typeof w.reset_at === 'number' && w.reset_at > 0 && w.reset_at <= 8.64e12 ? w.reset_at * 1000 : undefined;
    if (!windows.some(x => x.label === label)) windows.push({ label, remainingPercent, ...(resetsAt !== undefined ? { resetsAt } : {}) });
  }
  if (!windows.length) return { provider: 'openai-codex', kind: 'hidden' };
  windows.sort((a, b) => a.label === b.label ? 0 : a.label === '5h' ? -1 : 1);
  return { provider: 'openai-codex', kind: 'quota', windows, updatedAt: Date.now() };
}
async function readJSON(fetcher: typeof fetch, url: string, headers: Record<string, string>, signal: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, { headers, signal, redirect: 'error' });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Provider request failed'); }
  // Bound parsing and never incorporate an upstream body into an exception.
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty provider response');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 256_000) throw new Error('Oversized provider response'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('Invalid provider response'); }
}
const nativeRefresh = async (current: Grant, signal: AbortSignal): Promise<Grant> => {
  const oauth = openaiCodexProvider().auth.oauth;
  if (!oauth) throw new Error('OAuth unavailable');
  const result = grant({ kind: 'grant', payload: await oauth.refresh({ ...current }, signal) });
  if (!result) throw new Error('Invalid OAuth response');
  return result;
};
export function adapterResolver(ctx: AdapterServices, fetcher: typeof fetch = fetch, refresh = nativeRefresh) {
  return async (provider: string): Promise<Target | null> => {
    if (provider === 'deepseek-official') {
      const settings = ctx.settings.get('llm-deepseek');
      if (!settings) return null; // Only claim a registered official adapter.
      const options = object(settings);
      const environment = ctx.get('launchEnvironment');
      const base = options.baseURL ?? (environment ? environment.get('DEEPSEEK_BASE_URL')?.value : process.env.DEEPSEEK_BASE_URL) ?? 'https://api.deepseek.com';
      if (!officialURL(base, 'https://api.deepseek.com', ['', '/v1'])) return null;
      const ref = typeof options.apiKeyEnv === 'string' ? options.apiKeyEnv : 'DEEPSEEK_API_KEY';
      const key = (await ctx.credentials.resolve(ref))?.value;
      if (!key) throw new Error('Missing credential');
      return { key: hash(provider, key), load: async signal => parseDeepSeek(await readJSON(fetcher, 'https://api.deepseek.com/user/balance', { Authorization: `Bearer ${key}` }, signal)) };
    }
    if (provider !== 'openai-codex') return null;
    const options = object(object(object(ctx.settings.get('llm-pi-ai')).providers)['openai-codex']);
    // Settings can materialize headers: {}. An empty map overrides nothing;
    // reject real overrides (or malformed input), not presence of the container.
    const headers = options.headers;
    const hasHeaderOverrides = headers !== undefined && (headers === null || typeof headers !== 'object' || Array.isArray(headers) || Object.keys(headers).length > 0);
    // An explicit key/protocol or non-native backend may bill a different account.
    if (options.apiKeyEnv !== undefined || options.api !== undefined || options.protocol !== undefined || hasHeaderOverrides || (options.baseURL !== undefined && !officialURL(options.baseURL, 'https://chatgpt.com', ['/backend-api']))) return null;
    const initial = grant(await ctx.credentials.readRecord(CODEX_KEY));
    if (!initial) return null; // Only OAuth subscriptions, not API-key billing.
    return {
      key: hash(provider, initial.accountId, initial.access),
      load: async signal => {
        let current = grant(await ctx.credentials.readRecord(CODEX_KEY));
        if (!current || current.accountId !== initial.accountId) throw new Error('Credential changed');
        if (current.expires <= Date.now() + 60_000) {
          const record = await ctx.credentials.modifyRecord(CODEX_KEY, async stored => {
            const locked = grant(stored);
            if (!locked || locked.accountId !== initial.accountId) throw new Error('Credential changed');
            signal.throwIfAborted();
            if (locked.expires > Date.now() + 60_000) return undefined;
            const next = await refresh(locked, signal);
            if (next.accountId !== initial.accountId) throw new Error('Credential changed');
            return { kind: 'grant', payload: next };
          });
          current = grant(record);
          if (!current) throw new Error('Missing credential');
        }
        signal.throwIfAborted();
        return parseCodex(await readJSON(fetcher, 'https://chatgpt.com/backend-api/wham/usage', { Authorization: `Bearer ${current.access}`, 'ChatGPT-Account-Id': current.accountId, Accept: 'application/json' }, signal));
      },
    };
  };
}
