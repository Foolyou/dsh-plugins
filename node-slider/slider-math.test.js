import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeAtPosition } from './slider-math.js';

test('interval positions choose the left node, including past midpoint', () => {
  assert.equal(nodeAtPosition(60, 400, 5), 0);
  assert.equal(nodeAtPosition(180, 400, 5), 1);
  assert.equal(nodeAtPosition(285, 400, 5), 2);
});
test('next node activation zone overrides the interval rule', () => {
  assert.equal(nodeAtPosition(87, 400, 5), 0);
  assert.equal(nodeAtPosition(88, 400, 5), 1);
  assert.equal(nodeAtPosition(100, 400, 5), 1);
  assert.equal(nodeAtPosition(112, 400, 5), 1);
});
test('endpoints and out of range dragging clamp correctly', () => {
  assert.equal(nodeAtPosition(-100, 400, 5), 0);
  assert.equal(nodeAtPosition(0, 400, 5), 0);
  assert.equal(nodeAtPosition(400, 400, 5), 4);
  assert.equal(nodeAtPosition(600, 400, 5), 4);
});
test('small tracks keep distinct activation zones', () => {
  assert.equal(nodeAtPosition(4, 40, 5), 0);
  assert.equal(nodeAtPosition(7, 40, 5), 1);
  assert.equal(nodeAtPosition(0, 0, 5), 0);
});
