import { expect, type Page } from '@playwright/test';

/** Use the real settings upload path; generated color blocks never become repository assets. */
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
  await expect(page.getByRole('status')).toContainText('已保存 1 张');
  await page.getByRole('button', { name: '推理滑块图片', exact: true }).click();
  await page.locator('.mes-trigger').click();
  await expect(page.locator('.mes-thumb img')).toBeVisible();
}
