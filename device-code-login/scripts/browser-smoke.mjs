/** Opt-in integration test of the deployed DSH service. No models are invoked.
 * Cookies/private request credentials stay in memory: no traces, screenshots or storage files.
 * Run only after deploying device-code-login. --restart-service explicitly restarts the service.
 */
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { browserConfig, assertOutsideService } from './operation-config.mjs';

if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) {
  console.log('Usage: browser-smoke.mjs [--restart-service]\nRequires DSH_LOCAL_ORIGIN, DSH_LOGIN_ORIGIN and DSH_HOME. Restart additionally requires DSH_SERVICE.\nOptional PLAYWRIGHT_MODULE and CHROME_PATH; otherwise use installed Playwright and its Chromium.');
  process.exit(0);
}
let configuration;
try {
  configuration = browserConfig(process.env, process.argv.slice(2));
  if (configuration.restart) await assertOutsideService(configuration.unit);
} catch (error) { console.error(error.message); process.exit(1); }
const { localOrigin, remoteOrigin, home, restart, unit } = configuration;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const remoteURL = new URL(remoteOrigin);
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const launchOptions = { headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) };
const browsers = new Set(), peers = new Set();
let forwardedConnections = 0;
let crossSiteOrigin = remoteOrigin;
const externalPage = createHttpServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  // Use a constant link target controlled by this script, not incoming request data.
  response.end(`<a href="${crossSiteOrigin.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}/">Open Harness</a>`);
});
const forwarder = createServer(client => {
  forwardedConnections++;
  const upstream = connect(Number(remoteURL.port || 443), remoteURL.hostname);
  peers.add(client); peers.add(upstream);
  client.on('close', () => { peers.delete(client); upstream.destroy(); });
  upstream.on('close', () => { peers.delete(upstream); client.destroy(); });
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.pipe(upstream).pipe(client);
});
async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
}
async function eventually(check, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(message);
}
async function serviceReady(origin) {
  await eventually(async () => {
    try { return (await fetch(origin + '/', { signal: AbortSignal.timeout(3000) })).status === 200; }
    catch { return false; }
  }, 'Deployed service did not become ready');
}
async function openBrowser(args = []) {
  // Do not add ignoreHTTPSErrors: the TCP-relay test must preserve real TLS verification.
  const browser = await chromium.launch({ ...launchOptions, args });
  browsers.add(browser);
  return browser;
}
async function closeBrowser(browser) { await browser.close(); browsers.delete(browser); }
function approve(code) {
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/, 'The login page must display a human device code');
  try {
    execFileSync(process.execPath, [cli, '--home', home, 'approve', code, '--yes'], {
      encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
    });
  } catch {
    // Never forward CLI output (including request metadata) to a test report.
    throw new Error('Local device approval command failed; check plugin socket and DSH_HOME');
  }
}
async function checkLocalModels(page) {
  // Desktop viewport avoids the mobile drawer. A welcome acknowledgement may be
  // persisted by native UI; never enter/save a provider key or invoke a model.
  for (const pattern of [/^(Continue|继续|我知道了|知道了)$/i, /^(Configure later|Skip for now|Not now|稍后配置|暂时跳过|暂不配置|稍后)$/i]) {
    const dismiss = page.getByRole('button', { name: pattern });
    if (await dismiss.count() === 1 && await dismiss.isVisible()) await dismiss.click();
  }
  const settings = page.getByRole('button', { name: /^(设置|Settings)$/i });
  await settings.first().click({ timeout: 15000 });
  const dialog = page.getByRole('dialog').last();
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: /^(模型|Models)$/i }).click();
  // An editable provider row establishes the native settings mirror actually loaded.
  await dialog.getByRole('button', { name: /(?:编辑|Edit).*DeepSeek/i }).first().waitFor({ state: 'visible', timeout: 20000 });
  assert.equal(await dialog.getByText(/settings are unavailable in this browser|加载提供方目录失败/).count(), 0,
    'Local native Models settings must load without the remote-browser rejection');
}
async function visit(browser, origin, { storageState, login = false, externalLink = false, localModels = false } = {}) {
  const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    let pageErrors = 0, tokenRequests = 0, apiSuccesses = 0, frames = 0;
    page.on('pageerror', () => pageErrors++);
    page.on('request', request => { if (new URL(request.url()).searchParams.has('token')) tokenRequests++; });
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin === origin && url.pathname.startsWith('/api/') && response.status() === 200) apiSuccesses++;
    });
    page.on('websocket', socket => {
      if (new URL(socket.url()).pathname === '/api/remote.mux') socket.on('framereceived', () => frames++);
    });
    if (externalLink) {
      crossSiteOrigin = origin;
      await page.goto(`http://127.0.0.1:${externalPage.address().port}/`);
      await page.getByRole('link', { name: 'Open Harness' }).click();
    } else {
      assert.equal((await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })).status(), 200);
    }
    if (login) {
      const probe = await context.request.get(origin + '/api/nonexistent-device-login-smoke');
      assert.equal(probe.status(), 401, 'Native API must remain protected before authorization');
      // Read only the displayed human code, never the private browser request credential.
      const codeElement = page.locator(process.env.DSH_CODE_SELECTOR || '#code');
      await eventually(async () => /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test((await codeElement.textContent({ timeout: 5000 }) || '').trim()),
        'Device login did not display an authorization code');
      const code = (await codeElement.textContent()).trim();
      approve(code);
    }
    await eventually(async () => apiSuccesses > 0 && frames > 0 && await page.title() === 'DeepSeek Harness',
      'Native UI/API/WebSocket did not become ready');
    assert.equal(page.url(), origin + '/');
    assert.equal(tokenRequests, 0, 'Native startup token must never enter browser request URLs');
    if (localModels) await checkLocalModels(page);
    assert.equal(pageErrors, 0, 'Browser page must have no uncaught errors');
    const state = await context.storageState();
    const cookies = state.cookies.filter(cookie => cookie.name.startsWith('dsh-auth-'));
    assert.equal(cookies.length, 1, 'Expected exactly one native authentication cookie');
    const cookie = cookies[0];
    assert.equal(cookie.secure, new URL(origin).protocol === 'https:');
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'Strict');
    assert.equal(cookie.path, '/');
    assert.ok(Math.abs(cookie.expires - Date.now() / 1000 - 30 * 86400) < 600, 'Expected a 30-day absolute session expiry');
    if (storageState) {
      const previous = storageState.cookies.find(item => item.name === cookie.name);
      assert.ok(previous && previous.expires === cookie.expires, 'Reopening must not extend absolute expiry');
      assert.ok(previous && previous.value === cookie.value, 'Existing login should reuse its native session');
    }
    console.log(JSON.stringify({ origin, route: externalLink ? 'cross-site link + cookie' : login ? 'device approval' : 'existing cookie',
      tokenRequests, apiSuccesses, websocketFrames: frames, pageErrors, localModels }));
    return state;
  } finally { await context.close(); }
}

try {
  await serviceReady(localOrigin);
  await serviceReady(remoteOrigin);
  const initial = await openBrowser();
  const localState = await visit(initial, localOrigin, { login: true, localModels: true });
  const remoteState = await visit(initial, remoteOrigin, { login: true });
  await closeBrowser(initial);
  if (restart) {
    try { execFileSync('systemctl', ['--user', 'restart', unit], { timeout: 45000, stdio: 'pipe' }); }
    catch { throw new Error('Explicitly requested service restart failed'); }
    await serviceReady(localOrigin);
    await serviceReady(remoteOrigin);
    console.log('Service restarted; verifying the original in-memory browser sessions.');
  }
  const reopened = await openBrowser();
  await visit(reopened, localOrigin, { storageState: localState, localModels: true });
  await visit(reopened, remoteOrigin, { storageState: remoteState });
  await listen(externalPage, Number(process.env.LINK_TEST_PORT || 0));
  await visit(reopened, remoteOrigin, { storageState: remoteState, externalLink: true });
  await closeBrowser(reopened);
  // Simulate SSH -L using a byte-transparent TLS TCP relay. Original URL, SNI,
  // certificate validation and cookies are retained; no TLS termination occurs here.
  // A real external SSH host/network remains an operator-side integration check.
  await listen(forwarder, Number(process.env.TUNNEL_TEST_PORT || 0));
  const tunneled = await openBrowser([
    `--host-resolver-rules=MAP ${remoteURL.hostname} 127.0.0.1:${forwarder.address().port}`,
    '--disable-quic', '--no-proxy-server',
  ]);
  await visit(tunneled, remoteOrigin, { storageState: remoteState });
  await visit(tunneled, remoteOrigin, { login: true });
  assert.ok(forwardedConnections > 0, 'The remote tunnel checks must cross the TCP relay');
  console.log(JSON.stringify({ result: 'local + HTTPS device login, cookie persistence and TLS relay passed', forwardedConnections }));
} finally {
  for (const browser of browsers) await browser.close();
  for (const peer of peers) peer.destroy();
  if (forwarder.listening) await new Promise(resolve => forwarder.close(resolve));
  if (externalPage.listening) await new Promise(resolve => externalPage.close(resolve));
}
