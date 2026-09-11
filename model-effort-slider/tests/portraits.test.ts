import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HostUnavailableError, PortraitRequestError, type PortraitApi } from '../src/api';
import { createPortraitStore, portraitIndex, type StoreEnvironment } from '../src/portraits';
import { MAX_ADD_BATCH, portraitUrl, type PortraitInfo, type PortraitState } from '../src/protocol';
import { png } from './png';

const id = (n: number) => `${String(n).padStart(2, '0')}${'a'.repeat(22)}`;
const info = (value: string): PortraitInfo => ({ id: value, bytes: 1024, url: portraitUrl(value) });
const state = (revision: number, ids: readonly string[]): PortraitState => ({ revision, portraits: ids.map(info) });
const file = (name = 'a.png') => new File([png().slice().buffer], name, { type: 'image/png' });

/** Programmable fake host: records calls and serves a scripted state. */
function fakeApi() {
  const calls: string[] = [];
  let current = state(0, []);
  let fail: Error | undefined;
  const answer = () => { if (fail) throw fail; return current; };
  const api: PortraitApi = {
    read: async () => { calls.push('read'); return answer(); },
    add: async files => { calls.push(`add:${files.length}`); return answer(); },
    remove: async value => { calls.push(`remove:${value}`); return answer(); },
    move: async (value, delta) => { calls.push(`move:${value}:${delta}`); return answer(); },
    reset: async () => { calls.push('reset'); return answer(); },
  };
  return { api, calls, set: (next: PortraitState) => { current = next; }, failWith: (error?: Error) => { fail = error; } };
}

function environment(overrides: Partial<StoreEnvironment> = {}) {
  const listeners = new Set<() => void>();
  return {
    poll: (onChange: () => void) => { listeners.add(onChange); return () => { listeners.delete(onChange); }; },
    prepare: async () => new Blob([png().slice().buffer], { type: 'image/png' }),
    wake: () => listeners.forEach(listener => listener()),
    ...overrides,
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('hydrates from the host on first subscribe and keeps one snapshot per publish', async () => {
  const host = fakeApi(); host.set(state(4, [id(1), id(2)]));
  const store = createPortraitStore(host.api, environment());
  let renders = 0;
  const off = store.subscribe(() => { renders++; });
  await settle();
  assert.deepEqual(store.getSnapshot().portraits, [info(id(1)), info(id(2))]);
  assert.equal(store.getSnapshot().hostAvailable, true);
  assert.ok(renders > 0);
  const stable = store.getSnapshot();
  assert.equal(store.getSnapshot(), stable, 'an unchanged snapshot must be referentially stable');
  off();
});

test('add uploads prepared PNGs, move/remove/reset each adopt the host state', async () => {
  const host = fakeApi(); host.set(state(1, [id(1), id(2)]));
  const store = createPortraitStore(host.api, environment());
  const off = store.subscribe(() => {}); await settle();

  await store.add([file('a.png'), file('b.png')]);
  assert.deepEqual(host.calls.slice(-1), ['add:2']);

  host.set(state(2, [id(2), id(1)]));
  await store.move(id(1), -1);
  assert.deepEqual(store.getSnapshot().portraits.map(portrait => portrait.id), [id(2), id(1)]);
  assert.deepEqual(host.calls.slice(-1), [`move:${id(1)}:-1`]);

  host.set(state(3, [id(2)]));
  await store.remove(id(1));
  assert.deepEqual(store.getSnapshot().portraits.map(portrait => portrait.id), [id(2)]);

  host.set(state(4, []));
  await store.reset();
  assert.deepEqual(store.getSnapshot().portraits, []);
  assert.equal(store.getSnapshot().busy, 0);
  off();
});

test('a host refusal keeps the previous list and reports the host message', async () => {
  const host = fakeApi(); host.set(state(1, [id(1)]));
  const store = createPortraitStore(host.api, environment());
  const off = store.subscribe(() => {}); await settle();
  host.failWith(new PortraitRequestError(413, '宿主端图片总量已达上限，请先移除部分图片。'));
  await store.add([file()]);
  assert.deepEqual(store.getSnapshot().portraits, [info(id(1))]);
  assert.match(store.getSnapshot().error!, /总量已达上限/);
  assert.equal(store.getSnapshot().busy, 0);
  off();
});

test('a failing mutation leaves the saved list, and the next success clears the error', async () => {
  const host = fakeApi(); host.set(state(1, [id(1), id(2)]));
  const store = createPortraitStore(host.api, environment());
  const off = store.subscribe(() => {}); await settle();
  host.failWith(new PortraitRequestError(500, '宿主端无法处理图片请求。'));
  await store.move(id(1), 1);
  assert.deepEqual(store.getSnapshot().portraits.map(portrait => portrait.id), [id(1), id(2)]);
  assert.match(store.getSnapshot().error!, /无法处理图片请求/);
  assert.equal(store.getSnapshot().busy, 0);
  host.failWith(undefined);
  await store.move(id(1), 1);
  assert.equal(store.getSnapshot().error, null);
  off();
});

test('a missing host half is reported once and never blocks the selector', async () => {
  const host = fakeApi(); host.failWith(new HostUnavailableError());
  const store = createPortraitStore(host.api, environment());
  const off = store.subscribe(() => {}); await settle();
  assert.equal(store.getSnapshot().hostAvailable, false);
  assert.deepEqual(store.getSnapshot().portraits, []);
  off();
});

test('add refuses an oversized batch before touching the host and ignores a concurrent add', async () => {
  const host = fakeApi(); host.set(state(1, []));
  const store = createPortraitStore(host.api, environment());
  const off = store.subscribe(() => {}); await settle();
  await store.add(Array.from({ length: MAX_ADD_BATCH + 1 }, () => file()));
  assert.match(store.getSnapshot().error!, /每次最多上传/);
  assert.equal(host.calls.filter(call => call.startsWith('add')).length, 0);

  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const slow = environment({ prepare: async () => { await gate; return new Blob([png().slice().buffer], { type: 'image/png' }); } });
  const second = createPortraitStore(host.api, slow);
  const stop = second.subscribe(() => {}); await settle();
  const a = second.add([file()]);
  const b = second.add([file()]);
  release();
  await Promise.all([a, b]);
  assert.equal(host.calls.filter(call => call === 'add:1').length, 1, 'a second concurrent add is ignored');
  stop(); off();
});

test('polling adopts a changed host revision and ignores an unchanged one', async () => {
  const host = fakeApi(); host.set(state(1, [id(1)]));
  const env = environment();
  const store = createPortraitStore(host.api, env);
  const off = store.subscribe(() => {}); await settle();
  const before = host.calls.filter(call => call === 'read').length;
  env.wake(); await settle();
  assert.equal(host.calls.filter(call => call === 'read').length, before + 1);
  assert.deepEqual(store.getSnapshot().portraits, [info(id(1))], 'an unchanged revision keeps the list');

  host.set(state(2, [id(1), id(2)]));
  env.wake(); await settle();
  assert.deepEqual(store.getSnapshot().portraits, [info(id(1)), info(id(2))]);
  off();
});

test('portrait mapping uses every ordered range endpoint, with zero/one supported', () => {
  assert.equal(portraitIndex(0, 5, 0), undefined);
  assert.equal(portraitIndex(4, 5, 1), 0);
  assert.deepEqual(Array.from({ length: 4 }, (_, index) => portraitIndex(index, 4, 6)), [0, 2, 3, 5]);
  assert.deepEqual(Array.from({ length: 3 }, (_, index) => portraitIndex(index, 3, 9)), [0, 4, 8]);
  assert.deepEqual(Array.from({ length: 12 }, (_, index) => portraitIndex(index, 12, 3)), [0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2]);
});
