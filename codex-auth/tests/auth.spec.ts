import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page, request }) => { await request.post('/test/reset'); await page.goto('/'); });
test('device flow displays code, survives reload, completes and signs out', async ({ page, request }) => {
  await page.getByRole('button', { name: '设备码登录' }).click();
  await expect(page.getByLabel('设备码')).toHaveText('TEST-1234');
  await expect(page.getByRole('link', { name: /打开 OpenAI/ })).toHaveAttribute('href', 'https://auth.openai.com/codex/device');
  await page.reload(); await expect(page.getByLabel('设备码')).toHaveText('TEST-1234');
  await request.post('/test/complete');
  await expect(page.getByRole('status')).toContainText('授权完成');
  await expect(page.locator('.dca-status')).toContainText('凭据已保存');
  await expect(page.locator('body')).not.toContainText('secret-access-token');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByRole('button', { name: '确认退出', exact: true }).click();
  await expect(page.locator('.dca-status')).toContainText('未登录');
});
test('browser flow supports manual response and cancellation', async ({ page }) => {
  await page.getByRole('button', { name: '浏览器登录' }).click();
  await page.getByLabel('Paste redirect URL').fill('http://localhost:1455/auth/callback?code=test');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('授权完成');
  await page.getByRole('button', { name: '浏览器登录' }).click();
  await expect(page.getByLabel('Paste redirect URL')).toBeVisible();
  await page.getByRole('button', { name: '取消授权' }).click();
  await expect(page.getByRole('status')).toContainText('授权已取消');
  await expect(page.getByLabel('Paste redirect URL')).toHaveCount(0);
});
test('another tab sees busy status without its login link/code', async ({ page, context }) => {
  await page.getByRole('button', { name: '设备码登录' }).click();
  await expect(page.getByLabel('设备码')).toBeVisible();
  const second = await context.newPage(); await second.goto('/');
  await expect(second.getByRole('status')).toContainText('另一个页面');
  await expect(second.getByLabel('设备码')).toHaveCount(0);
  await expect(second.getByRole('button', { name: '设备码登录' })).toBeDisabled();
  await second.close();
});
test('safe error message and responsive layout', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await request.post('/test/fail');
  await page.getByRole('button', { name: '设备码登录' }).click();
  await expect(page.getByRole('alert')).toContainText('授权未完成');
  await expect(page.locator('body')).not.toContainText('secret-');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
