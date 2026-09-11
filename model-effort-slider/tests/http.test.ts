import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHandler } from '../src/http';
import { createHostState, type HostState } from '../src/state';
import { ACTION_FIELD, API_PATH, FILE_FIELD, MAX_ADD_BATCH, MAX_STORED_BYTES, portraitUrl, type PortraitState } from '../src/protocol';
import { png } from './png';

const PNG = { name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(png()) };

function form(action: string, extra: Record<string, string | readonly { name: string; mimeType: string; buffer: Buffer }[]> = {}): FormData {
  const data = new FormData();
  data.append(ACTION_FIELD, action);
  for (const [key, value] of Object.entries(extra)) {
    if (Array.isArray(value)) for (const file of value) data.append(FILE_FIELD, new File([file.buffer], file.name, { type: file.mimeType }));
    else data.append(key, value as string);
  }
  return data;
}

async function fixture(): Promise<{ handler: (request: Request) => Promise<Response>; state: HostState; close: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'mes-http-'));
  const state = createHostState(root);
  return { handler: createHandler(state), state, close: () => rm(root, { recursive: true, force: true }) };
}

const get = (path = API_PATH) => new Request(`http://127.0.0.1:12052${path}`);
const post = (data: FormData, path = API_PATH) => new Request(`http://127.0.0.1:12052${path}`, { method: 'POST', body: data });

test('GET returns the whole state and one portrait serves exact PNG bytes', async () => {
  const f = await fixture();
  try {
    const empty = await f.handler(get());
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { revision: 0, portraits: [] });

    const added = await f.handler(post(form('add', { files: [PNG] })));
    assert.equal(added.status, 200);
    const state = await added.json() as PortraitState;
    assert.equal(state.portraits.length, 1);
    assert.equal(state.portraits[0]!.bytes, png().byteLength);
    assert.equal(state.portraits[0]!.url, portraitUrl(state.portraits[0]!.id));

    const image = await f.handler(get(state.portraits[0]!.url));
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('Content-Type'), 'image/png');
    assert.equal(image.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.deepEqual(Array.from(new Uint8Array(await image.arrayBuffer())), Array.from(png()));

    const head = await f.handler(new Request(`http://127.0.0.1:12052${state.portraits[0]!.url}`, { method: 'HEAD' }));
    assert.equal(head.status, 200);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  } finally { await f.close(); }
});

test('mutations round-trip through one multipart POST', async () => {
  const f = await fixture();
  try {
    const files = [1, 2, 3].map(index => ({ ...PNG, name: `p${index}.png` }));
    const added = await (await f.handler(post(form('add', { files })))).json() as PortraitState;
    const [a, b, c] = added.portraits.map(p => p.id) as [string, string, string];
    const moved = await (await f.handler(post(form('move', { id: a, delta: '1' })))).json() as PortraitState;
    assert.deepEqual(moved.portraits.map(p => p.id), [b, a, c]);
    const removed = await (await f.handler(post(form('remove', { id: b })))).json() as PortraitState;
    assert.deepEqual(removed.portraits.map(p => p.id), [a, c]);
    const cleared = await (await f.handler(post(form('reset')))).json() as PortraitState;
    assert.deepEqual(cleared.portraits, []);
    assert.equal((await f.handler(get(portraitUrl(a)))).status, 404);
  } finally { await f.close(); }
});

test('rejects a missing host action, unknown ids, bad directions and unreadable bodies', async () => {
  const f = await fixture();
  try {
    for (const [request, status] of [
      [new Request(`http://127.0.0.1:12052${API_PATH}`, { method: 'POST' }), 400],
      [new Request(`http://127.0.0.1:12052${API_PATH}`, { method: 'POST', body: 'not multipart' }), 400],
      [post(form('nonsense')), 400],
      [post(form('add')), 400],
      [post(form('remove', { id: '../escape' })), 400],
      [post(form('remove', { id: 'a'.repeat(24) })), 200],
      [post(form('move', { id: 'a'.repeat(24), delta: '5' })), 400],
      [new Request(`http://127.0.0.1:12052${API_PATH}/x.png`, { method: 'DELETE' }), 405],
      [get(`${API_PATH}/whatever.png`), 404],
      [new Request('http://127.0.0.1:12052/api/elsewhere'), 404],
    ] as const) {
      const response = await f.handler(request);
      assert.equal(response.status, status, `${request.method} ${new URL(request.url).pathname}`);
      if (status !== 200) assert.equal(typeof (await response.json() as { error?: unknown }).error, 'string');
    }
  } finally { await f.close(); }
});

test('an oversized body is refused rather than parsed', async () => {
  const f = await fixture();
  try {
    // MAX_ADD_BATCH oversized PNGs, sent as one multipart body.
    const data = new FormData();
    data.append(ACTION_FIELD, 'add');
    for (let index = 0; index <= MAX_ADD_BATCH; index++) data.append(FILE_FIELD, new File([new Uint8Array(MAX_STORED_BYTES)], `p${index}.png`, { type: 'image/png' }));
    const response = await f.handler(post(data));
    assert.equal(response.status, 413);
    assert.match((await response.json() as { error: string }).error, /最多上传|过大|过多/);
    assert.equal((await f.state.read()).portraits.length, 0);
  } finally { await f.close(); }
});

test('a store failure surfaces as a 500 with its message rather than a throw', async () => {
  const f = await fixture();
  try {
    const failing = { ...f.state, read: async () => { throw new Error('disk on fire'); } };
    const response = await createHandler(failing)(get());
    assert.equal(response.status, 500);
    assert.match((await response.json() as { error: string }).error, /disk on fire/);
  } finally { await f.close(); }
});
