import { test, expect, type Page } from '@playwright/test';
import { MAX_SOURCE_BYTES, API_PATH } from '../src/protocol';
import { isolate } from './image-helpers';
isolate();

async function synthetic(page: Page, color = '#268bd2', width = 12, height = 12, mimeType = 'image/png') {
  const data = await page.evaluate(({ color, width, height, mimeType }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, width, height);
    return canvas.toDataURL(mimeType).split(',')[1];
  }, { color, width, height, mimeType });
  return { name: `synthetic.${mimeType.split('/')[1]}`, mimeType, buffer: Buffer.from(data, 'base64') };
}
async function openSettings(page: Page) {
  if (await page.getByRole('dialog').count()) await page.getByRole('dialog').press('Escape');
  await page.getByRole('button', { name: '推理滑块图片', exact: true }).click();
  return page.getByLabel(/添加图片/);
}
async function closeSettings(page: Page) {
  if (await page.getByRole('dialog').count()) await page.getByRole('dialog').press('Escape');
  await page.getByRole('button', { name: '推理滑块图片', exact: true }).click();
}
async function expectNoPortrait(page: Page) {
  const thumb = page.locator('.mes-thumb');
  await expect(thumb.locator('img')).toHaveCount(0);
  await expect(page.locator('.mes-thumb[data-image]')).toHaveCount(0);
  await expect(thumb.locator('*')).toHaveCount(0);
}

test('the selector renders without portraits and only the host route is requested', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.locator('.mes-trigger').click();
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuetext', 'HIGH');
  await expectNoPortrait(page);
  await openSettings(page);
  await expect(page.getByRole('heading', { name: '推理滑块图片' })).toBeVisible();
  await expect(page.getByText('未设置图片：使用纯色滑块。')).toBeVisible();
  await expect.poll(() => requests.filter(path => path !== API_PATH)).toEqual([]);
});

test('uploads reach the host, drive previews and the live selector, and survive reload', async ({ page }) => {
  const input = await openSettings(page);
  const files = await Promise.all([synthetic(page, '#f00'), synthetic(page, '#00f')]);
  await input.setInputFiles(files);
  await expect(page.getByRole('status')).toContainText('已保存 2 张');
  const previews = page.locator('.mes-portraits img');
  await expect(previews).toHaveCount(2);
  const first = await previews.nth(0).getAttribute('src'), second = await previews.nth(1).getAttribute('src');
  expect(first).toContain(`${API_PATH}?id=`);
  await expect.poll(() => previews.evaluateAll(images => images.every(image =>
    (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 160,
  ))).toBe(true);
  expect(first).not.toBe(second);

  await closeSettings(page);
  await page.locator('.mes-trigger').click();
  await expect(page.locator('.mes-thumb img')).toHaveAttribute('src', second!);
  await closeSettings(page);

  await page.getByRole('button', { name: '前移图片 2' }).click();
  await expect(previews.nth(0)).toHaveAttribute('src', second!);
  await page.locator('.mes-trigger').click();
  await expect(page.locator('.mes-thumb img')).toHaveAttribute('src', first!);
  await closeSettings(page);

  await page.reload();
  await openSettings(page);
  await expect(previews).toHaveCount(2);
  await expect(previews.nth(0)).toHaveAttribute('src', second!);

  await page.getByRole('button', { name: '移除图片 1' }).click();
  await expect(previews).toHaveCount(1);
  await openSettings(page);
  await page.locator('.mes-trigger').click();
  await expect(page.locator('.mes-thumb img')).toHaveAttribute('src', first!);
  await closeSettings(page);
  await page.getByRole('button', { name: '重置为纯色滑块' }).click();
  await expect(previews).toHaveCount(0);
  await page.reload(); await page.locator('.mes-trigger').click(); await expectNoPortrait(page);
});

test('many portraits are accepted: no count ceiling, with button and keyboard reordering', async ({ page }) => {
  const input = await openSettings(page);
  // Distinct colors: reordering identical images would be unobservable.
  const files = await Promise.all(Array.from({ length: 9 }, (_, index) => synthetic(page, `hsl(${index * 40} 70% 50%)`)));
  await input.setInputFiles(files);
  await expect(page.locator('.mes-portraits img')).toHaveCount(9);
  await expect(page.getByRole('status')).toContainText('已保存 9 张');
  await expect(input).toBeEnabled();
  await expect(page.getByRole('button', { name: '前移图片 1' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '后移图片 9' })).toBeDisabled();

  const previews = page.locator('.mes-portraits img');
  const first = await previews.nth(0).getAttribute('src'), second = await previews.nth(1).getAttribute('src');
  expect(first).not.toBe(second);
  await page.getByRole('button', { name: '后移图片 1' }).click();
  await expect(previews.nth(0)).toHaveAttribute('src', second!);
  await expect(previews.nth(1)).toHaveAttribute('src', first!);
  // Position 1 is no longer a boundary, so its forward button becomes usable.
  const secondItem = page.locator('.mes-portraits li').nth(1);
  await expect(secondItem.locator('button').first()).toBeEnabled();

  // Keyboard activation reorders too.
  const back = secondItem.locator('button').first();
  await back.focus(); await back.press('Enter');
  await expect(previews.nth(0)).toHaveAttribute('src', first!);

  await page.getByRole('button', { name: '移除图片 9' }).click();
  await expect(page.locator('.mes-portraits img')).toHaveCount(8);
});

test('an image load failure removes the frame without a pointer', async ({ page }) => {
  const input = await openSettings(page);
  await input.setInputFiles(await synthetic(page));
  await expect(page.locator('.mes-portraits img')).toHaveCount(1);
  await closeSettings(page);
  await page.locator('.mes-trigger').click();
  await expect(page.locator('.mes-thumb[data-image]')).toHaveCount(1);
  await page.locator('.mes-thumb img').dispatchEvent('error');
  await expectNoPortrait(page);
});

test('validates MIME, signatures, decode and dimensions without saving anything', async ({ page }) => {
  const input = await openSettings(page), valid = await synthetic(page);
  for (const [file, error] of [
    [{ name: 'vector.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') }, '不支持 SVG'],
    [{ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(MAX_SOURCE_BYTES + 1) }, '2 MiB'],
    [{ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) }, '2 MiB'],
    [{ name: 'spoof.png', mimeType: 'image/png', buffer: Buffer.from('not a png') }, '不符'],
    [{ ...valid, buffer: valid.buffer.subarray(0, 12) }, '无法解码'],
    [await synthetic(page, '#0f0', 4097, 1), '4096'],
  ] as const) {
    await input.setInputFiles([valid, file]);
    await expect(page.getByRole('alert')).toContainText(error);
    await expect(page.locator('.mes-portraits img')).toHaveCount(0);
  }
  // Same-file re-selection works after errors; PNG/JPEG/WebP decode and normalize to PNG.
  await input.setInputFiles([valid, await synthetic(page, '#abc', 12, 12, 'image/jpeg'), await synthetic(page, '#def', 12, 12, 'image/webp')]);
  await expect(page.locator('.mes-portraits img')).toHaveCount(3);
  for (const image of await page.locator('.mes-portraits img').all()) await expect(image).toHaveAttribute('src', new RegExp(`^${API_PATH}\\?id=[A-Za-z0-9_-]+$`));
});

test('a host refusal is visible and keeps the saved list', async ({ page }) => {
  const input = await openSettings(page);
  await input.setInputFiles(await synthetic(page));
  await expect(page.locator('.mes-portraits img')).toHaveCount(1);
  await page.route(`${API_PATH}*`, async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 413, contentType: 'application/json', body: JSON.stringify({ error: '宿主端图片总量已达上限，请先移除部分图片。' }) });
    else await route.continue();
  });
  await input.setInputFiles(await synthetic(page, '#f00'));
  await expect(page.getByRole('alert')).toContainText('宿主端图片总量已达上限');
  await expect(page.locator('.mes-portraits img')).toHaveCount(1);
});

test('a missing host half degrades to a pure-color selector with an explanatory error', async ({ page }) => {
  await page.route(`${API_PATH}*`, route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"missing"}' }));
  await page.reload();
  const input = await openSettings(page);
  await expect(page.getByRole('alert')).toContainText('宿主端图片服务未加载');
  await expect(input).toBeDisabled();
  await closeSettings(page);
  await page.locator('.mes-trigger').click();
  await expect(page.getByRole('slider')).toBeVisible();
  await expectNoPortrait(page);
});

test('another tab sees a host update after focus, with no localStorage involved', async ({ page, context }) => {
  await page.locator('.mes-trigger').click();
  const other = await context.newPage(); await other.goto('/');
  const input = await openSettings(other);
  await input.setInputFiles(await synthetic(other));
  await expect(other.locator('.mes-portraits img')).toHaveCount(1);

  // Same-tab wake path: a focus event re-reads the host revision.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.mes-thumb img')).toHaveCount(1, { timeout: 4000 });

  await other.getByRole('button', { name: '重置为纯色滑块' }).click();
  await expect(other.locator('.mes-portraits img')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.mes-thumb img')).toHaveCount(0, { timeout: 4000 });
  await other.close();
});
