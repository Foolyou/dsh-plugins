import { AuthController, type NativeServices } from './controller';
import { handler } from './http';
import { API_PATH } from './protocol';
interface Context extends NativeServices {
  effect(fn: () => (() => void | Promise<void>), name?: string): void;
  connection: { fetch: { register(route: { path: string; methods: readonly ['GET', 'POST']; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }): () => Promise<void> } };
}
export const name = 'codex-auth';
export const inject = ['authorization', 'credentials', 'connection'];
export function apply(ctx: Context) {
  const controller = new AuthController(ctx);
  ctx.effect(() => () => controller.dispose(), 'codex-auth cancel pending login');
  ctx.effect(() => ctx.connection.fetch.register({ path: API_PATH, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: handler(controller) }), 'codex-auth authenticated API');
}
