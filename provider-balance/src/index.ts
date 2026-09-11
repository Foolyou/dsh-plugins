import { adapterResolver, type AdapterServices } from './adapters';
import { BalanceController, handler, type SessionServices } from './controller';
interface Context extends AdapterServices, SessionServices {
  effect(fn: () => (() => void | Promise<void>), label?: string): void;
  connection: { fetch: { register(route: { path: string; methods: readonly ['GET']; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }): () => Promise<void> } };
}
export const name = 'provider-balance';
export const inject = ['connection', 'credentials', 'settings', 'sessions', 'sessionProjections', 'agentDefaultModel'];
export function apply(ctx: Context) {
  const controller = new BalanceController(ctx, adapterResolver(ctx));
  ctx.effect(() => () => controller.dispose(), 'provider-balance abort and clear cache');
  // The native carrier enforces Host/Origin/cookie checks before calling this route.
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/provider-balance', methods: ['GET'], requestBody: 'buffered', fetch: handler(controller) }), 'provider-balance authenticated read API');
}
