import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeChoice, effortChoices, selectEffort, selectModel } from '../src/model.ts';
test('preserves provider-owned IDs, names and order with arbitrary node counts', () => {
  for (const count of [0, 1, 2, 4, 7]) {
    const efforts = Array.from({ length: count }, (_, i) => ({ id: `vendor/custom:${i}`, name: `等级 ${i}` }));
    assert.deepEqual(effortChoices({ defaultEffort: 'vendor/custom:0', efforts }).map(e => [e.effort, e.label]), efforts.map(e => [e.id, e.name]));
  }
  assert.deepEqual(effortChoices(), []);
});
test('provider default is absent effort, never a fabricated request string', () => {
  const reasoning = { efforts: [{ id: 'none', name: '关闭' }, { id: 'deep', name: '深入' }] };
  const choices = effortChoices(reasoning);
  assert.equal(choices.length, 3);
  assert.equal(activeChoice({ provider: 'a', model: 'b' }, reasoning)?.id, 'provider-default');
  assert.deepEqual(selectEffort({ provider: 'a', model: 'b', reasoningEffort: 'deep' }, choices[0]), { provider: 'a', model: 'b' });
});
test('model switch takes destination default and never leaks source effort', () => {
  const current = { provider: 'one', model: 'same-id', reasoningEffort: 'max' };
  assert.deepEqual(selectModel('two', { id: 'same-id', name: 'Other', reasoning: { defaultEffort: 'budget-42', efforts: [] } }, current), { provider: 'two', model: 'same-id', reasoningEffort: 'budget-42' });
  assert.deepEqual(selectModel('two', { id: 'same-id', name: 'Other' }, current), { provider: 'two', model: 'same-id' });
  assert.deepEqual(selectModel('one', { id: 'same-id', name: 'Current' }, current), current);
});
test('unknown persisted effort is not coerced to an advertised effort', () => {
  assert.equal(activeChoice({ provider: 'a', model: 'b', reasoningEffort: 'retired' }, { defaultEffort: 'high', efforts: [{ id: 'high', name: 'High' }] }), undefined);
});
