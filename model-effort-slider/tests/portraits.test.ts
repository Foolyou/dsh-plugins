import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPortraitStore, MAX_FILE_BYTES, MAX_PORTRAIT_CHARS, parsePortraits, portraitIndex, STORAGE_KEY, validateFile } from '../src/portraits';

// Owned synthetic text, not a bundled image. Store tests inject their own decoder.
const portrait = () => `data:image/png;base64,${Buffer.from(`synthetic-${Math.random()}`).toString('base64')}`;
const serialized = (portraits: string[]) => JSON.stringify({ version: 1, portraits });
function fixture(raw: string | null = null) {
  const values = new Map(raw === null ? [] : [[STORAGE_KEY, raw]]);
  let failWrite = false;
  let listener: (() => void) | undefined;
  const decoded: string[] = [];
  const store = createPortraitStore({
    storage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (failWrite) throw new Error('quota'); values.set(key, value); }, removeItem: key => { if (failWrite) throw new Error('blocked'); values.delete(key); } }),
    listen: fn => { listener = fn; return () => { listener = undefined; }; },
    decode: async src => { decoded.push(src); },
  });
  return { store, values, decoded, block: () => { failWrite = true; }, event: () => listener?.() };
}

test('portrait mapping uses every ordered range endpoint, with zero/one supported', () => {
  assert.equal(portraitIndex(0, 5, 0), undefined);
  assert.equal(portraitIndex(4, 5, 1), 0);
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => portraitIndex(i, 4, 6)), [0, 2, 3, 5]);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => portraitIndex(i, 6, 6)), [0, 1, 2, 3, 4, 5]);
});
test('raster byte/type/size validation excludes spoofing and unsupported types', () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  validateFile({ size: 32, type: 'image/png' }, png);
  validateFile({ size: 32, type: 'image/jpeg' }, new Uint8Array([255, 216, 255]));
  validateFile({ size: 32, type: 'image/webp' }, new TextEncoder().encode('RIFFxxxxWEBP'));
  for (const type of ['image/svg+xml', 'image/gif', '', 'text/plain']) assert.throws(() => validateFile({ size: 32, type }, png));
  for (const size of [0, MAX_FILE_BYTES + 1]) assert.throws(() => validateFile({ size, type: 'image/png' }, png));
  assert.throws(() => validateFile({ size: 32, type: 'image/jpeg' }, png));
});
test('stored payload parser rejects versions, remote/SVG URLs, invalid base64 and oversized lists/data', () => {
  assert.deepEqual(parsePortraits(null), []);
  for (const raw of ['bad json', 'null', '{}', '{"version":2,"portraits":[]}', serialized(['https://example.org/a.png']), serialized(['data:image/svg+xml;base64,abc']), serialized(['data:image/png;base64,%%%']), serialized(Array(7).fill(portrait())), serialized(['data:image/png;base64,' + 'a'.repeat(MAX_PORTRAIT_CHARS)])]) {
    assert.throws(() => parsePortraits(raw));
  }
  const a = portrait(); assert.deepEqual(parsePortraits(serialized([a])), [a]);
});
test('store persists ordered preferences, reloads with decoding and resets only its own key', async () => {
  const f = fixture(); f.values.set('unrelated', 'keep');
  const a = portrait(), b = portrait();
  assert.equal(f.store.save([a, b]), true);
  await f.store.refresh();
  assert.deepEqual(f.decoded, [a, b]); assert.deepEqual(f.store.getSnapshot().portraits, [a, b]);
  assert.equal(f.store.save([b, a]), true);
  assert.deepEqual(parsePortraits(f.values.get(STORAGE_KEY)!), [b, a]);
  assert.equal(f.store.reset(), true); assert.deepEqual(f.store.getSnapshot().portraits, []);
  assert.equal(f.values.has(STORAGE_KEY), false); assert.equal(f.values.get('unrelated'), 'keep');
});
test('quota/denied storage errors preserve the last successfully saved state', () => {
  const f = fixture(); const a = portrait(); f.store.save([a]); f.block();
  assert.equal(f.store.save([portrait()]), false);
  assert.deepEqual(f.store.getSnapshot().portraits, [a]); assert.match(f.store.getSnapshot().error!, /quota/);
  assert.equal(f.store.reset(), false); assert.deepEqual(f.store.getSnapshot().portraits, [a]);
});
test('corrupt or undecodable saved data falls back without silently destroying storage', async () => {
  const f = fixture('bad json'); await f.store.refresh();
  assert.deepEqual(f.store.getSnapshot().portraits, []); assert.ok(f.store.getSnapshot().error);
  assert.equal(f.values.get(STORAGE_KEY), 'bad json');
  const store = createPortraitStore({ storage: () => ({ getItem: () => serialized([portrait()]), setItem() {}, removeItem() {} }), listen: () => () => {}, decode: async () => { throw new Error('decode failed'); } });
  await store.refresh(); assert.deepEqual(store.getSnapshot().portraits, []); assert.match(store.getSnapshot().error!, /decode failed/);
});
test('a slow hydration cannot overwrite a newer manual preference', async () => {
  let finish!: () => void;
  const store = createPortraitStore({ storage: () => ({ getItem: () => serialized([portrait()]), setItem() {}, removeItem() {} }), listen: () => () => {}, decode: () => new Promise<void>(resolve => { finish = resolve; }) });
  const hydration = store.refresh(); const a = portrait(); store.save([a]); finish(); await hydration;
  assert.deepEqual(store.getSnapshot().portraits, [a]);
});
test('subscriptions live update and dispose their storage listener', async () => {
  const f = fixture(); let changes = 0; const off = f.store.subscribe(() => { changes++; });
  await f.store.refresh(); const a = portrait(); f.values.set(STORAGE_KEY, serialized([a])); f.event();
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(f.store.getSnapshot().portraits, [a]);
  assert.ok(changes > 0); off(); const previous = changes; f.values.delete(STORAGE_KEY); f.event();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(changes, previous);
});
