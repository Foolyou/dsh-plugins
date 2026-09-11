import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { AuthController, ActionError } from '../src/controller.ts';
import { handler } from '../src/http.ts';
import { mockServices } from './mock.ts';
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const tick = () => delay(0);
test('device login uses native mode; credentials never enter status responses', async () => {
  const mock = mockServices(); const controller = new AuthController(mock.services);
  try {
    await controller.act(owner, { action: 'start', mode: 'device_code' }); await tick();
    const pending = await controller.state(owner);
    assert.equal(mock.chosen(), 'device_code');
    assert.equal(pending.attempt?.notices[0].code, 'TEST-1234');
    const foreign = await controller.state(other);
    assert.equal(foreign.attempt, null); assert.equal(foreign.busyElsewhere, true);
    await assert.rejects(controller.act(other, { action: 'cancel', attemptId: pending.attempt!.id }), ActionError);
    mock.complete(); await tick();
    const state = await controller.state(owner);
    assert.equal(state.attempt?.status, 'authorized');
    assert.deepEqual(state.credential, { present: true, expiresAt: 1234567890000 });
    assert.equal(JSON.stringify(state).includes('secret-'), false);
    assert.equal(JSON.stringify(state).includes('private-account'), false);
    assert.deepEqual(state.attempt?.notices, []);
  } finally { await controller.dispose(); }
});
test('browser prompt accepts only matching owner and live prompt; cancellation rejects it', async () => {
  const mock = mockServices(); const controller = new AuthController(mock.services);
  try {
    await controller.act(owner, { action: 'start', mode: 'browser' }); await tick();
    const { attempt } = await controller.state(owner);
    const answer = { action: 'answer' as const, attemptId: attempt!.id, promptId: attempt!.prompt!.id, value: 'http://localhost:1455/auth/callback?code=one-time' };
    await assert.rejects(controller.act(other, answer), ActionError);
    await assert.rejects(controller.act(owner, { ...answer, promptId: 'stale' }), ActionError);
    await controller.act(owner, { action: 'cancel', attemptId: attempt!.id });
    assert.equal((await controller.state(owner)).attempt?.status, 'cancelled');
    await assert.rejects(controller.act(owner, answer), ActionError);
    assert.equal((await controller.state(owner)).credential.present, false);
  } finally { await controller.dispose(); }
});
test('native callback withdraws manual prompt without turning success into cancellation', async () => {
  const mock = mockServices(); const controller = new AuthController(mock.services);
  try {
    await controller.act(owner, { action: 'start', mode: 'browser' }); await tick();
    mock.withdraw(); mock.complete(); await tick();
    assert.equal((await controller.state(owner)).attempt?.status, 'authorized');
  } finally { await controller.dispose(); }
});
test('overlapping login/logout rejected; successful logout deletes native record', async () => {
  const mock = mockServices(); const controller = new AuthController(mock.services);
  try {
    await controller.act(owner, { action: 'start', mode: 'device_code' }); await tick();
    await assert.rejects(controller.act(owner, { action: 'start', mode: 'browser' }), ActionError);
    await assert.rejects(controller.act(owner, { action: 'logout' }), ActionError);
    mock.complete(); await tick();
    await controller.act(owner, { action: 'logout' });
    assert.equal((await controller.state(owner)).credential.present, false);
  } finally { await controller.dispose(); }
});
test('timeout/disposal cancels pending flow; upstream token error is redacted', async () => {
  const mock = mockServices(); const controller = new AuthController(mock.services, 15);
  await controller.act(owner, { action: 'start', mode: 'device_code' });
  await delay(35); assert.equal((await controller.state(owner)).attempt?.status, 'cancelled');
  await controller.act(owner, { action: 'start', mode: 'browser' }); await tick(); await controller.dispose();
  assert.equal(mock.services.authorization.describe('')?.inFlight, false);
  const failed = mockServices(); failed.fail(); const failedController = new AuthController(failed.services);
  try {
    await failedController.act(owner, { action: 'start', mode: 'browser' }); await tick();
    const state = await failedController.state(owner);
    assert.equal(state.attempt?.status, 'failed'); assert.equal(JSON.stringify(state).includes('secret-'), false);
  } finally { await failedController.dispose(); }
});
test('HTTP boundary validates ownership headers, content types, size, and actions', async () => {
  const mock = mockServices(); const controller = new AuthController(mock.services); const fetch = handler(controller);
  try {
    const url = 'http://localhost/api/dsh-codex-auth';
    assert.equal((await fetch(new Request(url))).status, 400);
    const headers = { 'X-DSH-Auth-Owner': owner, 'Content-Type': 'application/json' };
    assert.equal((await fetch(new Request(url, { method: 'POST', headers, body: '{' }))).status, 400);
    assert.equal((await fetch(new Request(url, { method: 'POST', headers, body: JSON.stringify({ action: 'read-tokens' }) }))).status, 400);
    assert.equal((await fetch(new Request(url, { method: 'POST', headers, body: 'x'.repeat(12001) }))).status, 413);
    const response = await fetch(new Request(url, { headers }));
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { await controller.dispose(); }
});
