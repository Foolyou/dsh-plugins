import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base64ToBytes, bytesToBase64, dataUrlHeader, isPng } from '../src/bytes';
import { png } from './png';

test('base64 round-trips arbitrary bytes, including a large payload', () => {
  for (const size of [0, 1, 2, 255, 0x8000, 0x8001, 100_000]) {
    const source = new Uint8Array(size);
    for (let index = 0; index < size; index++) source[index] = (index * 31 + 7) % 256;
    assert.deepEqual(Array.from(base64ToBytes(bytesToBase64(source))), Array.from(source));
  }
});

test('the PNG signature is checked from bytes or from a data URL header', () => {
  assert.equal(isPng(png()), true);
  assert.equal(isPng(new Uint8Array([137, 80, 78, 71])), false);
  assert.equal(isPng(new Uint8Array()), false);
  assert.equal(isPng(dataUrlHeader(`data:image/png;base64,${Buffer.from(png()).toString('base64')}`)), true);
  assert.equal(isPng(dataUrlHeader('data:image/png;base64,iVBORw0KGgo=')), true);
  assert.throws(() => dataUrlHeader('not-a-data-url'));
});
