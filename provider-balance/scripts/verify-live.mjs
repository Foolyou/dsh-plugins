/** Explicit, opt-in check of a deployment. Never imports stored browser credentials. */
import { mkdir, writeFile } from 'node:fs/promises';
if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) {
  console.log('Requires DSH_GUI_ORIGIN and DSH_SESSION_ID. Optional CHROME_PATH; otherwise use Playwright Chromium. This script does not bypass GUI authentication.');
  process.exit(0);
}
let origin;
const sessionId = process.env.DSH_SESSION_ID;
try {
  if (process.argv.length !== 2) throw new Error('Unexpected arguments; use environment configuration');
  if (!process.env.DSH_GUI_ORIGIN) throw new Error('DSH_GUI_ORIGIN required');
  const url = new URL(process.env.DSH_GUI_ORIGIN);
  if (url.origin !== process.env.DSH_GUI_ORIGIN || !(url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
    throw new Error('DSH_GUI_ORIGIN must be canonical HTTPS or loopback HTTP without a path');
  }
  origin = url.origin;
  if (!sessionId?.trim()) throw new Error('DSH_SESSION_ID required');
} catch (error) { console.error(error instanceof TypeError ? 'Invalid DSH_GUI_ORIGIN' : error.message); process.exit(1); }
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let pageErrors = 0;
  page.on('pageerror', () => pageErrors++);
  const navigation = await page.goto(origin + '/', { waitUntil: 'networkidle' });
  if (navigation?.status() === 401) {
    console.log('GUI authentication required; this script will not recover or bypass a login token.');
    throw new Error('Live check not performed');
  }
  const response = await page.request.get(`${origin}/api/provider-balance?sessionId=${encodeURIComponent(sessionId)}`);
  const raw = await response.json();
  // Only counts/status are reported. Provider labels, error text and account data
  // may identify a deployment or include sensitive data, so do not record them.
  const report = { http: response.status(), balanceCount: Array.isArray(raw.balances) ? raw.balances.length : 0,
    windowCount: Array.isArray(raw.windows) ? raw.windows.length : 0, pageErrors,
    moduleLoaded: await page.evaluate(() => performance.getEntriesByType('resource').some(e => e.name.includes('dsh-provider-balance'))) };
  console.log(JSON.stringify(report));
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/live-verification.json', JSON.stringify({ ...report, checkedAt: new Date().toISOString() }, null, 2) + '\n');
} finally { await browser.close(); }
