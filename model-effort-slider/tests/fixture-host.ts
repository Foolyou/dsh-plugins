/**
 * Test host for the browser fixture: mounts the real host entry point
 * (`src/index.ts` → `apply`) through a minimal Connection stand-in, so the
 * browser tests exercise the shipped route rather than a second implementation.
 * `scripts/serve-test.mjs` owns the node HTTP wiring around these routes.
 */
import { apply, storageRoot } from '../src/index';
import { API_PATH } from '../src/protocol';

interface Route { path: string; methods: readonly string[]; requestBody: string; fetch(request: Request): Promise<Response> }

const routes: Route[] = [];
apply({
  effect: fn => { void fn(); },
  connection: { fetch: { register: route => { routes.push(route); return async () => {}; } } },
});

/** Path the host entry mounted; the test server routes exactly this. */
export const apiPath = API_PATH;
/** Storage root the host entry resolved; the test server points it at a temp dir. */
export const home = storageRoot();
/** The single registered portrait route, or undefined when the entry failed to mount. */
export const route = (): Route | undefined => routes[0];

/** Rebuild one Fetch Request from a node HTTP request (body already buffered). */
export function toRequest(request: { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; body: Uint8Array }, origin: string): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else if (value !== undefined) headers.set(key, value);
  }
  const method = request.method ?? 'GET';
  return new Request(new URL(request.url ?? '/', origin), {
    method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : request.body.slice().buffer,
  });
}
