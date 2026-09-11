/**
 * Host half: owns durable portrait files and serves them to the browser half.
 *
 * Mounted as the Node entry of this package (`main`). The browser half is the
 * `dsh.client` bundle of the same package; it calls {@link API_PATH} with the
 * page's own authenticated session, so no port, token or CORS handling exists
 * here. Deliberately a no-op when disabled: with no browser half loaded the
 * route is simply never requested.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { API_PATH } from './protocol';
import { createHandler } from './http';
import { createHostState } from './state';

interface Context {
  effect(fn: () => (() => void | Promise<void>), name?: string): void;
  connection: {
    fetch: {
      register(route: { path: string; methods: readonly ['GET', 'HEAD', 'POST']; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }): () => Promise<void>;
    };
  };
}

export const name = 'dsh-model-effort-slider';
// `connection` is the only host service this half needs; the browser half keeps
// using `slots`, `modelDirectories` and `sessions` exactly as before.
export const inject = ['connection'];

/** Storage root; override with `DSH_MODEL_EFFORT_SLIDER_HOME` (tests do). */
export function storageRoot(): string {
  return process.env.DSH_MODEL_EFFORT_SLIDER_HOME ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'model-effort-slider');
}

export function apply(ctx: Context) {
  const state = createHostState(storageRoot());
  ctx.effect(() => ctx.connection.fetch.register({
    path: API_PATH, methods: ['GET', 'HEAD', 'POST'], requestBody: 'buffered', fetch: createHandler(state),
  }), 'model-effort-slider portraits');
}
