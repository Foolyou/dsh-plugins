#!/usr/bin/env node
/** Explicitly configured owner operation. Run OUTSIDE the target service's cgroup.
 * Rotates only the native browser-session signing record. No secret is logged.
 */
import assert from 'node:assert/strict';
import { isDeepStrictEqual, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { revokeConfig, resolveDshBin, assertOutsideService } from './operation-config.mjs';
const exec = promisify(execFile);
if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) {
  console.log('Usage: revoke-all.mjs --confirm-revoke-all\nRequires explicit DSH_HOME, DSH_SERVICE and DSH_REVOKE_ORIGINS (JSON origin array).\nSet DSH_BIN to the native CLI entry or install dsh on PATH. Run outside the target service.');
  process.exit(0);
}
let configuration;
try { configuration = revokeConfig(process.env, process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exit(1); }
const { origins, unit, filename } = configuration;
let stage = 'confirmation', credentialPlugin, connectionPlugin, stopped = false;
async function control(action) { await exec('systemctl', ['--user', action, unit], { timeout: 45000 }); }
async function main() {
  // Check this before loading credentials or contacting any configured target.
  await assertOutsideService(unit);
  stage = 'resolve DSH installation';
  const bin = await resolveDshBin(process.env);
  stage = 'load native credential service';
  const requireDsh = createRequire(bin);
  const { Context } = await import(requireDsh.resolve('@deepseek-ai/cordis'));
  const { default: LocalCredentials, parseCredentialsDocument } = await import(requireDsh.resolve('@deepseek-ai/dsh-credentials-local'));
  const { credentialKey } = await import(requireDsh.resolve('@deepseek-ai/dsh-credentials'));
  const Connection = await import(requireDsh.resolve('@deepseek-ai/dsh-client-connection'));
  const key = credentialKey('client-connection', 'browser-session');
  const readDocument = async () => parseCredentialsDocument(await readFile(filename, 'utf8'), filename);
  const initial = await readDocument();
  assert(initial.records.has(key), 'Existing browser-session record required');
  const ctx = new Context();
  credentialPlugin = ctx.plugin(LocalCredentials, { path: filename, watch: false });
  await credentialPlugin.await();
  connectionPlugin = ctx.plugin(Connection, { trustedHosts: origins.map(origin => new URL(origin).host), cookieMaxAgeDays: 30 });
  await connectionPlugin.await();
  // Test cookies use the current signing key, remain in memory, and are never
  // delivered to a browser. They prove global old-key rejection after rotation.
  stage = 'verify current signing key against live service';
  const cookies = new Map();
  for (const origin of origins) {
    const anonymous = await fetch(origin + '/api/nonexistent-revocation-check', { redirect: 'error', signal: AbortSignal.timeout(5000) });
    assert.equal(anonymous.status, 401, 'Target must expose the native unauthenticated API fence');
    const tokenUrl = new URL(ctx.connection.authenticatedUrl(origin));
    let cookie;
    ctx.connection.authorizeIndex({ method: 'GET', url: tokenUrl.pathname + tokenUrl.search, headers: { host: new URL(origin).host } }, {
      writeHead(status, headers) { assert.equal(status, 303); cookie = headers['set-cookie']?.split(';')[0]; }, end() {},
    });
    assert(cookie, 'Native signing check did not produce a cookie');
    const response = await fetch(origin + '/api/nonexistent-revocation-check', { headers: { cookie }, redirect: 'error', signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 404, 'Expected authenticated native API fallback; refusing unverified target');
    cookies.set(origin, cookie);
  }
  stage = 'stop service and clear in-memory pairing requests';
  await control('stop'); stopped = true;
  stage = 'rotate browser-session signing record';
  const before = await readDocument();
  const old = before.records.get(key);
  assert(old?.kind === 'grant' && old.payload?.version === 1 && typeof old.payload.secret === 'string', 'Unexpected session record format');
  await ctx.credentials.modifyRecord(key, async current => {
    assert(isDeepStrictEqual(current, old), 'Session record changed concurrently');
    return { ...current, payload: { ...current.payload, secret: randomBytes(32).toString('base64url') } };
  });
  const after = await readDocument();
  assert(after.records.get(key)?.payload.secret !== old.payload.secret, 'Session signing key did not rotate');
  before.records.delete(key); after.records.delete(key);
  assert(isDeepStrictEqual(before, after), 'Unexpected change outside browser-session record');
  console.log(JSON.stringify({ signingKeyRotated: true, otherCredentialsUnchanged: true }));
  stage = 'start existing service';
  await control('start'); stopped = false;
  stage = 'verify old cookies rejected and device login available';
  for (const origin of origins) {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const r = await fetch(origin + '/', { signal: AbortSignal.timeout(3000) });
        if (r.status === 200 && (await r.text()).includes('授权此浏览器')) { ready = true; break; }
      } catch {}
      await delay(500);
    }
    assert(ready, 'Device login did not become ready');
    const cookie = cookies.get(origin);
    const r = await fetch(origin + '/api/nonexistent-revocation-check', { headers: { cookie }, redirect: 'error', signal: AbortSignal.timeout(5000) });
    assert.equal(r.status, 401, 'Old signing-key cookie must be rejected');
    const page = await fetch(origin + '/', { headers: { cookie }, redirect: 'error', signal: AbortSignal.timeout(5000) });
    assert((await page.text()).includes('授权此浏览器'), 'Old cookie must show reauthorization page');
    console.log(JSON.stringify({ origin, oldCookieStatus: r.status, deviceLoginAvailable: true }));
  }
  cookies.clear();
  console.log('All previous native browser sessions invalidated; pending requests cleared. No new browser login was approved.');
}
try { await main(); }
catch { console.error('Revocation operation failed at stage: ' + stage + '. No credential values are included in this report.'); process.exitCode = 1; }
finally {
  if (stopped) { try { await control('start'); } catch { console.error('Could not restore service; start the explicitly configured DSH_SERVICE manually'); process.exitCode = 1; } }
  await connectionPlugin?.dispose();
  await credentialPlugin?.dispose();
}
