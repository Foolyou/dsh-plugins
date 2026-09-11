import { expect, test, type Page } from '@playwright/test';
import { API_PATH } from '../src/protocol';

/**
 * Register one `beforeEach` that clears the shared host store and drops the old
 * browser-only key, then loads the fixture. Installed by every spec file, so
 * specs stay independent even though one fixture server owns the storage root.
 */
export function isolate() {
  test.beforeEach(async ({ page }) => {
    await page.request.post(API_PATH, { multipart: { action: 'reset' } });
    await page.addInitScript(() => { try { localStorage.removeItem('dsh.model-effort-slider.portraits.v1'); } catch { /* denial means it is already invisible */ } });
    await page.goto('/');
  });
}

/** Crop a canvas-generated color block, upload it through the real settings UI, and reopen the selector. */
export async function uploadTestImage(page: Page) {
  if (await page.getByRole('dialog').count()) await page.getByRole('dialog').press('Escape');
  await page.getByRole('button', { name: '推理滑块图片', exact: true }).click();
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 12; canvas.height = 12;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#268bd2'; context.fillRect(0, 0, 12, 12);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page.getByLabel(/添加图片/).setInputFiles({ name: 'test-color.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await expect(page.locator('.mes-portraits img')).toHaveCount(1);
  await page.getByRole('button', { name: '推理滑块图片', exact: true }).click();
  await page.locator('.mes-trigger').click();
  await expect(page.locator('.mes-thumb img')).toBeVisible();
}
