import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { browserConfig, revokeConfig, resolveDshBin, originValue } from '../scripts/operation-config.mjs';
const base = { DSH_HOME: '/tmp/example-runtime-home', DSH_LOCAL_ORIGIN: 'http://127.0.0.1:12052',
  DSH_LOGIN_ORIGIN: 'https://dsh.example.net', DSH_SERVICE: 'example-dsh.service',
  DSH_REVOKE_ORIGINS: '["http://127.0.0.1:12052","https://dsh.example.net"]' };
const run = (file, args, env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL(file, import.meta.url)), ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error('Configuration check timed out')); }, 5000);
  child.stdout.on('data', value => output += value); child.stderr.on('data', value => output += value);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
});
test('operational browser targets and home are explicit; restart is separately opt-in', () => {
  for (const key of ['DSH_HOME', 'DSH_LOCAL_ORIGIN', 'DSH_LOGIN_ORIGIN']) {
    const env = { ...base }; delete env[key]; assert.throws(() => browserConfig(env, []), new RegExp(key));
  }
  const ordinary = browserConfig({ ...base, DSH_SERVICE: undefined }, []);
  assert.equal(ordinary.restart, false); assert.equal(ordinary.unit, undefined);
  assert.throws(() => browserConfig({ ...base, DSH_SERVICE: undefined }, ['--restart-service']), /DSH_SERVICE/);
  assert.equal(browserConfig(base, ['--restart-service']).unit, 'example-dsh.service');
  assert.throws(() => browserConfig(base, ['--unexpected']), /Usage/);
  assert.throws(() => browserConfig({ ...base, DSH_HOME: 'relative' }, []), /absolute/);
});
test('maintenance origins reject secrets, URLs with paths, ambiguous and insecure targets', () => {
  for (const origin of ['http://public.example.net', 'https://user:pass@dsh.example.net', 'https://dsh.example.net/', 'https://dsh.example.net/?token=example', 'file:///tmp/example']) {
    assert.throws(() => originValue(origin, 'TARGET'), /TARGET/);
  }
  assert.throws(() => browserConfig({ ...base, DSH_LOCAL_ORIGIN: 'https://public.example.net' }, []), /DSH_LOCAL_ORIGIN/);
  assert.throws(() => browserConfig({ ...base, DSH_LOGIN_ORIGIN: 'http://localhost:12053' }, []), /DSH_LOGIN_ORIGIN/);
});
test('revocation requires confirmation and explicit origin array, home and service', () => {
  const args = ['--confirm-revoke-all'];
  assert.throws(() => revokeConfig(base, []), /confirm/);
  for (const key of ['DSH_HOME', 'DSH_SERVICE', 'DSH_REVOKE_ORIGINS']) {
    const env = { ...base }; delete env[key]; assert.throws(() => revokeConfig(env, args), new RegExp(key));
  }
  for (const value of ['null', '[]', '{}', '"https://dsh.example.net"', '[123]', '["http://public.example.net"]']) {
    assert.throws(() => revokeConfig({ ...base, DSH_REVOKE_ORIGINS: value }, args));
  }
  assert.throws(() => revokeConfig({ ...base, DSH_SERVICE: '--system' }, args), /DSH_SERVICE/);
  assert.throws(() => revokeConfig({ ...base, DSH_BIN: 'relative.js' }, args), /absolute/);
  assert.throws(() => revokeConfig({ ...base, DSH_REVOKE_ORIGINS: '["http://localhost","https://localhost"]' }, args), /distinct/);
  assert.equal(revokeConfig(base, args).origins.length, 2);
});
test('DSH CLI discovery uses explicit path or PATH, with no installation-directory default', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-cli-config-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cli = join(directory, 'cli.js'); await writeFile(cli, '// test only\n', { mode: 0o700 });
  await symlink(cli, join(directory, 'dsh'));
  assert.equal(await resolveDshBin({ PATH: directory }), cli);
  assert.equal(await resolveDshBin({ DSH_BIN: cli, PATH: '' }), cli);
  await assert.rejects(resolveDshBin({ PATH: '' }), /DSH_BIN/);
});
test('missing operational configuration performs no HTTP, credential writes or service commands', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-safe-exit-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, 'runtime'); await mkdir(home);
  const credential = join(home, '.credentials.yaml'); await writeFile(credential, '# sentinel test only\n');
  const marker = join(directory, 'service-called');
  await writeFile(join(directory, 'systemctl'), `#!/bin/sh\nprintf called > '${marker}'\n`, { mode: 0o700 });
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.end('unexpected'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = { ...base, PATH: directory, DSH_HOME: home, DSH_LOCAL_ORIGIN: `http://127.0.0.1:${server.address().port}` };
  for (const [file, args, missing] of [
    ['../scripts/browser-smoke.mjs', [], 'DSH_HOME'],
    ['../scripts/browser-smoke.mjs', ['--restart-service'], 'DSH_SERVICE'],
    ['../scripts/revoke-all.mjs', ['--confirm-revoke-all'], 'DSH_REVOKE_ORIGINS'],
    ['../../provider-balance/scripts/verify-live.mjs', [], 'DSH_SESSION_ID'],
  ]) {
    const current = { ...env, DSH_GUI_ORIGIN: env.DSH_LOCAL_ORIGIN }; delete current[missing];
    const result = await run(file, args, current);
    assert.equal(result.code, 1); assert.match(result.output, new RegExp(missing));
  }
  assert.equal(requests, 0);
  assert.equal(await readFile(credential, 'utf8'), '# sentinel test only\n');
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});
test('help for operational scripts needs no configuration and has no deployment target', async () => {
  for (const file of ['../scripts/browser-smoke.mjs', '../scripts/revoke-all.mjs', '../../provider-balance/scripts/verify-live.mjs']) {
    const result = await run(file, ['--help'], {}); assert.equal(result.code, 0); assert.match(result.output, /DSH_/);
  }
});
