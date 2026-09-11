import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdtemp, writeFile, rm, stat, mkdir, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { apply, resolveConfig } from '../src/index.js';
import { Requests } from '../src/state.js';
import { startSocket, socketPath, callSocket } from '../src/socket.js';
import { loginPage } from '../src/page.js';
const dshBin = process.env.DSH_BIN || execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim();
const requireDsh = createRequire(realpathSync(dshBin));
const { Context } = await import(requireDsh.resolve('@deepseek-ai/cordis'));
const Connection = await import(requireDsh.resolve('@deepseek-ai/dsh-client-connection'));
const ORIGIN = 'https://host.example.ts.net', LOCAL = 'http://127.0.0.1:12052';
class Records { async modifyRecord(_key, update) { const next = await update(this.record); if (next !== undefined) this.record = next; return this.record; } }
async function fixture(t, records = new Records()) {
  const home = await mkdtemp(join(tmpdir(), 'device-code-login-test-'));
  const frontendIndex = join(home, 'index.html');
  await writeFile(frontendIndex, '<html><head></head><body>native frontend</body></html>');
  const ctx = new Context(); ctx.provide('credentials', records);
  const plugin = ctx.plugin(Connection, { trustedHosts: [new URL(ORIGIN).host], cookieMaxAgeDays: 30 }); await plugin.await();
  const routes = new Map(), disposers = [];
  const services = { connection: ctx.connection, effect: fn => disposers.push(fn()), webServer: { host: '127.0.0.1', renderIndex: html => html.replace('</head>', '<script>window.__DSH_BOOT__={};</script></head>'), register(route) { assert.equal(routes.has(route.path), false); routes.set(route.path, route.handler); return () => routes.delete(route.path); } } };
  await apply(services, { origins: [ORIGIN, LOCAL], frontendIndex, home });
  const stop = async () => { for (const dispose of disposers.splice(0).reverse()) await dispose(); };
  t.after(async () => { await stop(); await plugin.dispose(); await rm(home, { recursive: true, force: true }); });
  return { home, routes, connection: ctx.connection, records, stop, frontendIndex, services };
}
function request({ path = '/', method = 'GET', origin = ORIGIN, headers = {}, data = {}, rawHeaders } = {}) {
  const req = Readable.from([JSON.stringify(data)]);
  Object.assign(req, { url: path, method, headers: { host: new URL(origin).host, ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}), ...headers }, socket: { remoteAddress: '127.0.0.1' }, ...(rawHeaders ? { rawHeaders } : {}) });
  return req;
}
async function invoke(f, req) {
  const reply = { status: 0, headers: {}, body: '', writeHead(status, headers) { this.status = status; this.headers = headers; }, end(value) { this.body = value || ''; } };
  await f.routes.get(new URL(req.url, ORIGIN).pathname)(req, reply); return reply;
}
async function create(f, origin = ORIGIN) { const r = await invoke(f, request({ path: '/auth/device-code/create', method: 'POST', origin })); assert.equal(r.status, 200); return JSON.parse(r.body); }
const status = (f, secret, origin = ORIGIN) => invoke(f, request({ path: '/auth/device-code/status', method: 'POST', origin, data: { secret } }));
const command = (f, action, code) => callSocket(socketPath(f.home), { action, code });
async function approve(f, origin = ORIGIN) { const row = await create(f, origin); await command(f, 'approve', row.code); return status(f, row.secret, origin); }

test('canonical origins reject paths, credentials, remote HTTP and authority ambiguity', () => {
  const base = { frontendIndex: '/tmp/index.html' };
  for (const origin of ['http://evil.example', 'https://host.example/', 'https://USER@host.example', 'https://host.example:443', 'file:///tmp/x', 'https://host.example?q=x']) assert.throws(() => resolveConfig({ ...base, origins: [origin] }));
  assert.throws(() => resolveConfig({ ...base, origins: ['http://localhost', 'https://localhost'] }));
  for (const origin of [ORIGIN, LOCAL, 'http://[::1]:12052', 'http://localhost:12052']) assert.equal(resolveConfig({ ...base, origins: [origin] }).origins[0].origin, origin);
});
test('page CSP, no cookie/token until approval, native frontend only when authenticated', async t => {
  const f = await fixture(t), r = await invoke(f, request());
  assert.match(r.body, /授权此浏览器/); assert.equal(r.headers['set-cookie'], undefined);
  assert.match(r.headers['content-security-policy'], /script-src 'nonce-/); assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.doesNotMatch(r.body, /token=|localStorage|__DSH_BOOT__/);
  assert.equal((await invoke(f, request({ method: 'HEAD' }))).body, '');
  const cross = await invoke(f, request({ headers: { 'sec-fetch-site': 'cross-site' } }));
  assert.match(cross.body, /http-equiv="refresh"/); assert.doesNotMatch(cross.body, /auth\/device-code/);
  assert.equal((await invoke(f, request({ headers: { host: 'evil.example' } }))).status, 403);
  assert.equal((await invoke(f, request({ method: 'POST' }))).status, 405);
});
test('native HTTPS 30-day HttpOnly cookie authenticates APIs and GUI, issues exactly once', async t => {
  const f = await fixture(t), row = await create(f);
  assert.match(row.secret, /^[A-Za-z0-9_-]{43}$/); assert.match(row.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const listed = await command(f, 'list'); assert.equal(listed.length, 1); assert.doesNotMatch(JSON.stringify(listed), new RegExp(row.secret));
  await command(f, 'approve', row.code);
  const r = await status(f, row.secret); assert.equal(r.status, 200); assert.equal(JSON.parse(r.body).state, 'approved');
  assert.match(r.headers['set-cookie'], /Max-Age=2592000;/); assert.match(r.headers['set-cookie'], /HttpOnly; SameSite=Strict; Secure$/);
  const cookie = r.headers['set-cookie'].split(';')[0];
  assert.equal(f.connection.requestRejection(request({ headers: { cookie } })), undefined);
  const gui = await invoke(f, request({ headers: { cookie } })); assert.match(gui.body, /native frontend/); assert.match(gui.body, /__DSH_BOOT__/); assert.match(gui.body, /<base href="\/">/);
  const again = await status(f, row.secret); assert.ok([404, 429].includes(again.status)); assert.equal(again.headers['set-cookie'], undefined);
  assert.equal(f.connection.requestRejection(request({ headers: { cookie: cookie + 'x' } })), 401);
  assert.equal(f.connection.requestRejection(request({ origin: LOCAL, headers: { cookie } })), 401);
});
test('HTTP loopback can pair without Secure cookie and native token recovery remains supported', async t => {
  const f = await fixture(t), r = await approve(f, LOCAL);
  assert.match(r.headers['set-cookie'], /HttpOnly/); assert.doesNotMatch(r.headers['set-cookie'], /Secure/);
  for (const origin of [LOCAL, ORIGIN]) {
    const recovery = new URL(f.connection.authenticatedUrl(origin));
    const r = await invoke(f, request({ origin, path: recovery.pathname + recovery.search }));
    assert.equal(r.status, 303); assert.equal(r.headers.location, '/'); assert.match(r.headers['set-cookie'], /HttpOnly/);
    if (origin === ORIGIN) assert.match(r.headers['set-cookie'], /Secure/);
    assert.doesNotMatch(JSON.stringify(r), /token=/);
  }
});
test('native cookie survives plugin/server restart and expires at absolute30 days', async t => {
  const f = await fixture(t), login = await approve(f), cookie = login.headers['set-cookie'].split(';')[0];
  const g = await fixture(t, f.records);
  const before = Date.now, now = Date.now();
  try {
    Date.now = () => now + 29 * 86400000;
    assert.equal(g.connection.requestRejection(request({ headers: { cookie } })), undefined);
    Date.now = () => now + 30 * 86400000 + 1000;
    assert.equal(g.connection.requestRejection(request({ headers: { cookie } })), 401);
  } finally { Date.now = before; }
});
test('POST exact Origin/native Host fence, duplicate headers and input bounds', async t => {
  const f = await fixture(t);
  for (const headers of [{ origin: undefined }, { origin: 'null' }, { origin: ORIGIN + '/' }, { origin: LOCAL }, { host: 'evil.example' }, { 'sec-fetch-site': 'cross-site' }, { origin: [ORIGIN, ORIGIN] }]) {
    const r = await invoke(f, request({ path: '/auth/device-code/create', method: 'POST', headers })); assert.equal(r.status, 403); assert.equal(r.headers['set-cookie'], undefined);
  }
  const duplicate = await invoke(f, request({ path: '/auth/device-code/create', method: 'POST', rawHeaders: ['Host', new URL(ORIGIN).host, 'Origin', ORIGIN, 'origin', ORIGIN, 'Content-Type', 'application/json'] })); assert.equal(duplicate.status, 403);
  for (const data of [null, [], { secret: 'x'.repeat(2000) }]) assert.equal((await invoke(f, request({ path: '/auth/device-code/status', method: 'POST', data }))).status, 400);
  assert.equal((await invoke(f, request({ path: '/auth/device-code/create' }))).status, 405);
  assert.equal((await invoke(f, request({ path: '/auth/device-code/create', method: 'POST', headers: { 'content-type': 'text/plain' } }))).status, 400);
  const row = await create(f);
  assert.equal((await status(f, row.secret, LOCAL)).status, 404);
});
test('denial, expiry, origin binding, capacity, rate limits and secret non-disclosure', () => {
  let now = 100000; const state = new Requests({ now: () => now, capacity: 2 });
  const a = state.create(ORIGIN, { peer: 'peer' });
  assert.throws(() => state.create(ORIGIN, {}), /rate-limited/);
  assert.equal(state.status(a.secret, ORIGIN), 'pending');
  assert.throws(() => state.status(a.secret, ORIGIN), /rate-limited/);
  now += 2000; assert.throws(() => state.status(a.secret, LOCAL), /unknown-request/);
  now += 2000; const b = state.create(LOCAL, {}); now += 2000; assert.throws(() => state.create(LOCAL, {}), /rate-limited/);
  state.command({ action: 'deny', code: a.code }); now += 2000; assert.equal(state.status(a.secret, ORIGIN), 'denied');
  now += 2000; assert.throws(() => state.status(a.secret, ORIGIN), /unknown-request/);
  assert.throws(() => state.command({ action: 'approve', code: a.code }), /unknown-request/);
  assert.throws(() => state.command({ action: 'oops', code: b.code }), /invalid-command/);
  assert.doesNotMatch(JSON.stringify(state.command({ action: 'list' })), /secret|nextPoll/);
  now += 600000; assert.equal(state.command({ action: 'list' }).length, 0);
  assert.throws(() => state.status(b.secret, LOCAL), /unknown-request/);
});
test('socket owner permissions, no live takeover, lifecycle cleans routes and socket', async t => {
  const f = await fixture(t), path = socketPath(f.home);
  assert.equal((await stat(join(f.home, 'device-code-login'))).mode & 0o777, 0o700);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(startSocket(path, new Requests()), /already active/);
  assert.deepEqual(await command(f, 'list'), []);
  await f.stop(); assert.equal(f.routes.size, 0); await assert.rejects(stat(path), { code: 'ENOENT' });
});
test('socket rejects unsafe directory modes, symlink directory, foreign path', async t => {
  const home = await mkdtemp(join(tmpdir(), 'device-code-socket-')); t.after(() => rm(home, { recursive: true, force: true }));
  const dir = join(home, 'device-code-login'); await mkdir(dir, { mode: 0o755 }); await chmod(dir, 0o755);
  await assert.rejects(startSocket(socketPath(home), new Requests()), /unsafe socket directory/);
  await chmod(dir, 0o700); await writeFile(socketPath(home), 'do not delete');
  await assert.rejects(startSocket(socketPath(home), new Requests()), /non-socket/);
  await rm(dir, { recursive: true }); const target = join(home, 'elsewhere'); await mkdir(target, { mode: 0o700 }); await symlink(target, dir);
  await assert.rejects(startSocket(socketPath(home), new Requests()), /unsafe socket directory/);
});
test('stale socket left by killed process is reclaimed; CLI approval requires explicit confirmation', async t => {
  const f = await fixture(t); const row = await create(f);
  const cli = new URL('../src/cli.js', import.meta.url).pathname;
  const run = args => new Promise(resolve => { const p = spawn(process.execPath, [cli, '--home', f.home, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; p.stdout.on('data', c => out += c); p.stderr.on('data', c => out += c); p.on('close', code => resolve({ code, out })); });
  const no = await run(['approve', row.code]); assert.equal(no.code, 1); assert.match(no.out, /Interactive confirmation required/);
  const yes = await run(['approve', row.code, '--yes']); assert.equal(yes.code, 0); assert.match(yes.out, /NOT a verified identity/); assert.doesNotMatch(yes.out, new RegExp(row.secret));
  assert.equal((await status(f, row.secret)).status, 200);
  await f.stop();
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import net from 'node:net';const s=net.createServer();s.listen(${JSON.stringify(socketPath(f.home))},()=>process.stdout.write('ready'));`], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); }); child.kill('SIGKILL'); await new Promise(resolve => child.once('close', resolve));
  const stop = await startSocket(socketPath(f.home), new Requests()); assert.deepEqual(await command(f, 'list'), []); await stop();
});
test('activation requires trusted origin and readable frontend before creating socket', async t => {
  const f = await fixture(t); await f.stop();
  await assert.rejects(apply(f.services, { origins: ['https://untrusted.example'], frontendIndex: f.frontendIndex, home: f.home }), /trustedHosts/);
  await assert.rejects(apply(f.services, { origins: [ORIGIN], frontendIndex: join(f.home, 'missing'), home: f.home }), { code: 'ENOENT' });
  await assert.rejects(stat(socketPath(f.home)), { code: 'ENOENT' });
});
test('CLI works through a package-manager-style symlink and prints help', async t => {
  const f = await fixture(t), link = join(f.home, 'dsh-device-auth');
  await symlink(new URL('../src/cli.js', import.meta.url).pathname, link);
  const run = args => new Promise(resolve => {
    const p = spawn(process.execPath, [link, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '';
    p.stdout.on('data', c => out += c); p.stderr.on('data', c => out += c); p.on('close', code => resolve({ code, out }));
  });
  const help = await run(['--help']); assert.equal(help.code, 0); assert.match(help.out, /Usage: dsh-device-auth/);
  const list = await run(['--home', f.home, 'list']); assert.equal(list.code, 0); assert.deepEqual(JSON.parse(list.out), []);
});
test('login page keeps transient retry secret only in closure and has no external resources', () => {
  const page = loginPage('nonce'); assert.match(page, /e.status!==429/); assert.match(page, /expiresAt/); assert.doesNotMatch(page, /localStorage|sessionStorage|document.cookie|https?:\/\//);
});
