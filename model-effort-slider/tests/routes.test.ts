import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/index';
import { createHostState } from '../src/state';
import { API_PATH, type PortraitState } from '../src/protocol';
import { png } from './png';

test('existing portraits are readable through exactly registered host paths and methods', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mes-routes-'));
  const previous = process.env.DSH_MODEL_EFFORT_SLIDER_HOME;
  try {
    // Seed persisted files before mounting, just like a host restart.
    const saved = await createHostState(root).add([{ name: 'existing.png', bytes: png() }]);
    process.env.DSH_MODEL_EFFORT_SLIDER_HOME = root;
    type Route = { path: string; methods: readonly string[]; fetch(request: Request): Promise<Response> };
    const routes = new Map<string, Route>();
    apply({
      effect: fn => { fn(); },
      connection: { fetch: { register: route => {
        assert.equal(routes.has(route.path), false);
        routes.set(route.path, route);
        return async () => { routes.delete(route.path); };
      } } },
    });
    // Mirror Connection.createSharedFetchHandler: no implicit prefix matching.
    const dispatch = (path: string, method = 'GET') => {
      const request = new Request(`http://localhost${path}`, { method });
      const route = routes.get(new URL(request.url).pathname);
      return route?.methods.includes(method) ? route.fetch(request) : Promise.resolve(new Response(null, { status: 404 }));
    };
    const state = await (await dispatch(API_PATH)).json() as PortraitState;
    assert.equal(state.revision, saved.revision);
    assert.equal(state.portraits[0]!.id, saved.portraits[0]!.id);
    const url = state.portraits[0]!.url;
    const response = await dispatch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png());
    const head = await dispatch(url, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(png().length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal((await dispatch(`${API_PATH}/unregistered.png`)).status, 404);
    assert.equal((await dispatch(`${API_PATH}?id=../manifest.json`)).status, 400);
    assert.equal((await dispatch(`${API_PATH}?id=${'a'.repeat(24)}`)).status, 404);
  } finally {
    if (previous === undefined) delete process.env.DSH_MODEL_EFFORT_SLIDER_HOME;
    else process.env.DSH_MODEL_EFFORT_SLIDER_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});
