import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHostState, PortraitError, pngSize, type HostState } from '../src/state';
import { MAX_STORED_BYTES, MAX_TOTAL_BYTES } from '../src/protocol';
import { png, pngVaried } from './png';

const upload = (bytes: Uint8Array) => ({ name: 'image.png', bytes });
const padded = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set(png());
  return bytes;
};

async function fixture(): Promise<{ state: HostState; root: string; close: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'mes-'));
  return { state: createHostState(root), root, close: () => rm(root, { recursive: true, force: true }) };
}

test('starts empty and reads the PNG size from the IHDR chunk', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.state.read(), { revision: 0, portraits: [] });
    assert.deepEqual(pngSize(png(160, 160)), { width: 160, height: 160 });
    assert.deepEqual(pngSize(png(12, 12)), { width: 12, height: 12 });
    assert.equal(pngSize(new Uint8Array([1, 2, 3])), undefined);
  } finally { await f.close(); }
});

test('adds any number of portraits across batches, with no count limit', async () => {
  const f = await fixture();
  try {
    const many = Array.from({ length: 70 }, (_, index) => upload(pngVaried(index + 1)));
    let added = await f.state.add(many.slice(0, 32));
    added = await f.state.add(many.slice(32, 64));
    added = await f.state.add(many.slice(64));
    assert.equal(added.portraits.length, 70);
    assert.deepEqual((await f.state.read()).portraits.map(p => p.id), added.portraits.map(p => p.id));
    assert.deepEqual(Array.from(await f.state.image(added.portraits[7]!.id) ?? []), Array.from(many[7]!.bytes));
    assert.equal(await f.state.image('does-not-exist-at-all'), undefined);
  } finally { await f.close(); }
});

test('rejects invalid batches without saving anything', async () => {
  const f = await fixture();
  try {
    const good = upload(png());
    for (const [batch, status] of [
      [[], 400],
      [[good, { name: 'tiny.png', bytes: new Uint8Array([137, 80, 78, 71]) }], 415],
      [[good, upload(png(12, 12))], 415],
      [[good, upload(new Uint8Array(MAX_STORED_BYTES + 1))], 413],
      [[good, { name: 'svg.svg', bytes: new Uint8Array(200) }], 415],
    ] as const) {
      await assert.rejects(f.state.add(batch), (error: unknown) => error instanceof PortraitError && error.status === status);
      assert.equal((await f.state.read()).portraits.length, 0, 'a rejected batch must not half-save');
    }
    assert.deepEqual(await readdir(join(f.root, 'portraits')).catch(() => []), []);
  } finally { await f.close(); }
});

test('enforces the total byte budget across requests', async () => {
  const f = await fixture();
  try {
    const batch = Array.from({ length: 32 }, () => upload(padded(MAX_STORED_BYTES)));
    const perRequest = batch.length * MAX_STORED_BYTES;
    const accepted = Math.floor(MAX_TOTAL_BYTES / perRequest);
    for (let index = 0; index < accepted; index++) await f.state.add(batch);
    await assert.rejects(f.state.add(batch), (error: unknown) => error instanceof PortraitError && error.status === 413);
    assert.equal((await f.state.read()).portraits.length, accepted * batch.length);
  } finally { await f.close(); }
});

test('moves, removes and clears while keeping the manifest ordered', async () => {
  const f = await fixture();
  try {
    const added = await f.state.add([upload(pngVaried(1)), upload(pngVaried(2)), upload(pngVaried(3))]);
    const [a, b, c] = added.portraits.map(p => p.id) as [string, string, string];
    assert.deepEqual((await f.state.move(a, 1)).portraits.map(p => p.id), [b, a, c]);
    // Out-of-range moves and repeated removals are no-ops that do not bump the revision.
    const moved = (await f.state.read()).revision;
    assert.equal((await f.state.move(b, -1)).revision, moved);
    assert.equal((await f.state.move('unknown-id-000000', 1)).revision, moved);
    const removed = await f.state.remove(b);
    assert.deepEqual(removed.portraits.map(p => p.id), [a, c]);
    assert.equal(removed.revision, moved + 1);
    assert.equal((await f.state.remove(b)).revision, removed.revision);
    assert.equal((await f.state.clear()).portraits.length, 0);
    assert.deepEqual((await f.state.read()).portraits, []);
    assert.deepEqual(await readdir(join(f.root, 'portraits')), []);
  } finally { await f.close(); }
});

test('drops manifest ids whose file vanished', async () => {
  const f = await fixture();
  try {
    const added = await f.state.add([upload(pngVaried(1)), upload(pngVaried(2))]);
    const [first, second] = added.portraits.map(p => p.id) as [string, string];
    await writeFile(join(f.root, 'portraits', 'stray.txt'), 'ignored, never served');
    await rm(join(f.root, 'portraits', `${second}.png`));
    assert.deepEqual((await f.state.read()).portraits.map(p => p.id), [first]);
  } finally { await f.close(); }
});

test('a corrupt manifest recovers to empty instead of throwing, and the next write repairs it', async () => {
  const f = await fixture();
  try {
    await f.state.add([upload(png())]);
    await writeFile(join(f.root, 'manifest.json'), '{not json');
    assert.deepEqual((await f.state.read()).portraits, []);
    const repaired = await f.state.add([upload(pngVaried(9))]);
    assert.equal(repaired.portraits.length, 1);
    assert.equal(JSON.parse(await readFile(join(f.root, 'manifest.json'), 'utf8')).version, 1);
  } finally { await f.close(); }
});

test('concurrent mutations serialize on one chain', async () => {
  const f = await fixture();
  try {
    await Promise.all(Array.from({ length: 8 }, (_, index) => f.state.add([upload(pngVaried(index + 1))])));
    const state = await f.state.read();
    assert.equal(state.portraits.length, 8);
    assert.equal(state.revision, 8);
    assert.equal(new Set(state.portraits.map(p => p.id)).size, 8);
  } finally { await f.close(); }
});
