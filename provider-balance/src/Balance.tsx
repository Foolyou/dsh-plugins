import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { BalanceResult } from './controller';
interface Directory {
  store: { subscribe(fn: () => void): () => void; getSnapshot(): { current?: { provider: string } | null } };
  load(): Promise<unknown>;
}
export interface BalanceProps { directory: Directory; sessionId: string; available: boolean }
const supported = (p: string | undefined) => p === 'deepseek-official' || p === 'openai-codex';
const nameOf = (p: string) => p === 'deepseek-official' ? 'DeepSeek' : 'Codex';
const money = (currency: string, amount: string) => `${currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : `${currency} `}${amount}`;
const percent = (n: number) => `${Math.floor(n * 10) / 10}%`;
function valid(value: unknown, provider: string): value is BalanceResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as BalanceResult;
  if (r.provider !== provider) return false;
  if (r.kind === 'hidden' || r.kind === 'unavailable') return true;
  if (r.kind === 'balance') return Array.isArray(r.balances) && r.balances.length > 0 && r.balances.every(b => typeof b.currency === 'string' && typeof b.amount === 'string');
  if (r.kind === 'quota') return Array.isArray(r.windows) && r.windows.length > 0 && r.windows.every(w => typeof w.label === 'string' && Number.isFinite(w.remainingPercent) && w.remainingPercent >= 0 && w.remainingPercent <= 100);
  return false;
}
export function Balance({ directory, sessionId, available }: BalanceProps) {
  const snapshot = useSyncExternalStore(fn => directory.store.subscribe(fn), () => directory.store.getSnapshot());
  const provider = snapshot.current?.provider;
  const identity = `${sessionId}\0${provider ?? ''}`;
  const [state, setState] = useState<{ identity: string; result: BalanceResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => { if (available) void directory.load().catch(() => {}); }, [directory, available]);
  useEffect(() => {
    setState(null); setBusy(false);
    if (!available || !provider || !supported(provider)) { refresh.current = () => {}; return; }
    let active = true, inFlight: AbortController | undefined;
    async function load() {
      if (!active || inFlight || document.visibilityState === 'hidden') return;
      const controller = new AbortController(); inFlight = controller;
      setBusy(true);
      const timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetch(`/api/provider-balance?sessionId=${encodeURIComponent(sessionId)}`, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Unavailable');
        const value: unknown = await response.json();
        if (active) setState({ identity, result: valid(value, provider!) ? value : { provider: provider!, kind: 'unavailable' } });
      } catch {
        if (active) setState({ identity, result: { provider: provider!, kind: 'unavailable' } });
      } finally { clearTimeout(timeout); inFlight = undefined; if (active) setBusy(false); }
    }
    const request = () => { void load(); };
    refresh.current = request;
    request();
    const interval = setInterval(request, 60_000);
    window.addEventListener('focus', request);
    document.addEventListener('visibilitychange', request);
    return () => { active = false; clearInterval(interval); inFlight?.abort(); refresh.current = () => {}; window.removeEventListener('focus', request); document.removeEventListener('visibilitychange', request); };
  }, [identity, available, provider, sessionId]);
  const result = state?.identity === identity ? state.result : null;
  if (!available || !provider || !supported(provider) || !result || result.kind === 'hidden') return null;
  const unavailable = result.kind === 'unavailable';
  const low = result.windows?.some(w => w.remainingPercent <= 10) || result.balances?.some(b => Number(b.amount) <= 0);
  const summary = unavailable ? '暂不可用' : result.kind === 'balance' ? result.balances!.map(b => money(b.currency, b.amount)).join(' · ') : result.windows!.map(w => `${w.label} 余${percent(w.remainingPercent)}`).join(' · ');
  const detail = [nameOf(provider) + (result.kind === 'quota' ? ' · 剩余额度' : ' · 账户余额'), unavailable ? '暂时无法查询，点击重试' : summary,
    ...(result.windows ?? []).filter(w => w.resetsAt).map(w => `${w.label} 重置：${new Date(w.resetsAt!).toLocaleString()}`),
    ...(result.updatedAt ? [`更新：${new Date(result.updatedAt).toLocaleTimeString()}`] : []), '每分钟自动查询 · 点击刷新（短时缓存）'].join('\n');
  return <button type="button" className={`pb-pill${low ? ' pb-low' : ''}${unavailable ? ' pb-unavailable' : ''}`} onClick={() => refresh.current()} disabled={busy}
    title={detail} aria-label={`${nameOf(provider)} ${result.kind === 'quota' ? '剩余额度' : '余额'} ${summary}，点击刷新`} aria-busy={busy}>
    <svg className="pb-icon" width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="3" stroke="currentColor" strokeWidth="1.4"/><path d="M13 8h4.5v4H13a2 2 0 0 1 0-4Z" stroke="currentColor" strokeWidth="1.4"/></svg>
    <span className="pb-provider">{nameOf(provider)}</span><span className="pb-values" aria-live="polite">{summary}</span>
  </button>;
}
