import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const bundled = await build({ entryPoints: ['tests/browser-harness.tsx'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', loader: { '.css': 'text' } });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 320 } });
  let provider = 'deepseek-official', mode = 'normal', requests = 0, release;
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('http://balance.test/**', async route => {
    if (route.request().url().includes('/api/provider-balance')) {
      requests++;
      const selected = provider, requestedMode = mode;
      if (requestedMode === 'held') await new Promise(resolve => { release = resolve; });
      const body = requestedMode === 'unavailable' ? { provider: selected, kind: 'unavailable' }
        : selected === 'deepseek-official' ? { provider: selected, kind: 'balance', balances: [{ currency: 'CNY', amount: '123.45' }], updatedAt: Date.now() }
        : selected === 'openai-codex' ? { provider: selected, kind: 'quota', windows: [{ label: '5h', remainingPercent: 78, resetsAt: Date.now() + 3600000 }, { label: '周', remainingPercent: 42 }], updatedAt: Date.now() }
        : { provider: selected, kind: 'hidden' };
      await route.fulfill({ json: body });
    } else await route.fulfill({ contentType: 'text/html', body: '<html lang="zh"><head></head><body style="margin:24px;background:#fafafa;color:#333;font:14px system-ui"><div id="root" style="display:flex;justify-content:flex-end;max-width:100%"></div></body></html>' });
  });
  await page.goto('http://balance.test/');
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  await expect(page.locator('#root')).toContainText('123.45');
  console.log('PASS DeepSeek balance');
  provider = 'openai-codex';
  await page.evaluate(() => window.balanceTest.select('openai-codex'));
  await expect(page.locator('#root')).toContainText('78%');
  await expect(page.locator('#root')).toContainText('42%');
  await expect(page.locator('#root')).not.toContainText('123.45');
  console.log('PASS provider switch and both quota windows');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/quota-desktop.png' });
  await page.setViewportSize({ width: 360, height: 240 });
  await page.screenshot({ path: 'artifacts/quota-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  console.log('PASS narrow layout');
  const before = requests;
  await page.locator('#root button').first().click();
  await expect.poll(() => requests).toBeGreaterThan(before);
  console.log('PASS manual refresh');
  provider = 'unsupported';
  await page.evaluate(() => window.balanceTest.select('unsupported'));
  await expect(page.locator('#root')).toBeEmpty();
  console.log('PASS unsupported hidden');
  provider = 'deepseek-official'; mode = 'unavailable';
  await page.evaluate(() => window.balanceTest.select('deepseek-official'));
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.locator('#root')).not.toContainText('123.45');
  await expect(page.locator('#root')).not.toContainText('0.00');
  console.log('PASS failure never shows zero or stale amount');
  provider = 'unsupported';
  await page.evaluate(() => window.balanceTest.select('unsupported'));
  await expect(page.locator('#root')).toBeEmpty();
  provider = 'deepseek-official'; mode = 'held';
  await page.evaluate(() => window.balanceTest.select('deepseek-official'));
  await expect.poll(() => typeof release).toBe('function');
  await expect(page.locator('#root')).toBeEmpty();
  provider = 'openai-codex'; mode = 'normal';
  await page.evaluate(() => window.balanceTest.select('openai-codex'));
  await expect(page.locator('#root')).toContainText('78%');
  release();
  await expect(page.locator('#root')).not.toContainText('123.45');
  console.log('PASS delayed response from previous provider cannot replace current quota');
  await page.evaluate(() => window.balanceTest.dispose());
  await expect(page.locator('#root')).toBeEmpty();
  expect(errors).toEqual([]);
  console.log('PASS lifecycle disposal and no browser errors');
} finally { await browser.close(); }
