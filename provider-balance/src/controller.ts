export interface BalanceResult {
  provider: string | null;
  kind: 'balance' | 'quota' | 'hidden' | 'unavailable';
  balances?: { currency: string; amount: string }[];
  windows?: { label: string; remainingPercent: number; resetsAt?: number }[];
  updatedAt?: number;
}
export interface Target { key: string; load(signal: AbortSignal): Promise<BalanceResult> }
interface Session { requestHeader(): { config: { provider: string } } | undefined }
export interface SessionServices {
  sessions: { get(id: string): Session | undefined };
  sessionProjections: { stateOf(session: Session, key: 'modelSelection'): { pending: { provider: string } | null } | undefined };
  agentDefaultModel: { currentSelection(): { provider: string } };
}
export function currentProvider(ctx: SessionServices, id: string): string | null {
  const session = ctx.sessions.get(id);
  if (!session) return null; // Never wake a cold session merely to display billing.
  const projection = ctx.sessionProjections.stateOf(session, 'modelSelection');
  if (!projection) return null;
  return projection.pending?.provider ?? session.requestHeader()?.config.provider ?? ctx.agentDefaultModel.currentSelection().provider;
}
export class BalanceController {
  private cache = new Map<string, { until: number; result: BalanceResult }>();
  private pending = new Map<string, Promise<BalanceResult>>();
  private stop = new AbortController();
  constructor(private services: SessionServices, private resolve: (provider: string) => Promise<Target | null>, private now = Date.now) {}
  async state(sessionId: string): Promise<BalanceResult> {
    const provider = currentProvider(this.services, sessionId);
    if (!provider || this.stop.signal.aborted) return { provider, kind: 'hidden' };
    try {
      const target = await this.resolve(provider);
      if (!target) return { provider, kind: 'hidden' };
      if (this.stop.signal.aborted) return { provider, kind: 'hidden' };
      const cached = this.cache.get(target.key);
      if (cached && cached.until > this.now()) return cached.result;
      let request = this.pending.get(target.key);
      if (!request) {
        request = this.load(provider, target).finally(() => this.pending.delete(target.key));
        this.pending.set(target.key, request);
      }
      return await request;
    } catch {
      // No upstream errors, credentials, account IDs, or request headers cross to the browser.
      return { provider, kind: 'unavailable' };
    }
  }
  private async load(provider: string, target: Target): Promise<BalanceResult> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 15_000);
    try {
      const signal = AbortSignal.any([timeout.signal, this.stop.signal]);
      const result = await target.load(signal);
      this.remember(target.key, result, 45_000);
      return result;
    } catch {
      const result: BalanceResult = { provider, kind: 'unavailable' };
      this.remember(target.key, result, 15_000);
      return result;
    } finally { clearTimeout(timer); }
  }
  private remember(key: string, result: BalanceResult, ttl: number) {
    if (this.stop.signal.aborted) return;
    for (const [key, entry] of this.cache) if (entry.until <= this.now()) this.cache.delete(key);
    if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { result, until: this.now() + ttl });
  }
  dispose() { this.stop.abort(); this.cache.clear(); this.pending.clear(); }
}
export function handler(controller: BalanceController) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
    const id = new URL(request.url).searchParams.get('sessionId');
    if (!id || !/^[a-zA-Z0-9_-]{1,160}$/.test(id)) return Response.json({ error: 'Invalid session' }, { status: 400, headers });
    try { return Response.json(await controller.state(id), { headers }); }
    catch { return Response.json({ provider: null, kind: 'hidden' }, { headers }); }
  };
}
