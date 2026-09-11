import { test, expect, type Page } from '@playwright/test';
import { MAX_FILE_BYTES, STORAGE_KEY } from '../src/portraits';

async function synthetic(page: Page, color = '#268bd2', width = 12, height = 12, mimeType = 'image/png') {
  const data = await page.evaluate(({ color, width, height, mimeType }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, width, height);
    return canvas.toDataURL(mimeType).split(',')[1];
  }, { color, width, height, mimeType });
  return { name: `synthetic.${mimeType.split('/')[1]}`, mimeType, buffer: Buffer.from(data, 'base64') };
}
async function settings(page: Page) {
  await page.getByRole('button', { name: '推理滑块图片', exact: true }).click();
  return page.getByLabel(/添加图片/);
}
async function expectNoPortrait(page: Page) {
  const thumb = page.locator('.mes-thumb');
  await expect(thumb.locator('img')).toHaveCount(0);
  await expect(page.locator('.mes-thumb[data-image]')).toHaveCount(0);
  expect(await thumb.evaluate(node => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, border: style.borderTopColor, shadow: style.boxShadow };
  })).toEqual({ background: 'rgba(0, 0, 0, 0)', border: 'rgba(0, 0, 0, 0)', shadow: 'none' });
  await expect(thumb.locator('*')).toHaveCount(0);
  await expect(page.locator('.mes-pointer')).toHaveCount(0);
}
test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('production settings registration exists and default thumb has no image or requests', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.locator('.mes-trigger').click();
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuetext', 'HIGH');
  await expectNoPortrait(page);
  await settings(page);
  await expect(page.getByRole('heading', { name: '推理滑块图片' })).toBeVisible();
  await expect(page.getByText('未设置图片：使用纯色滑块。')).toBeVisible();
  expect(requests).toEqual([]);
});

test('uploads stay local, preview/live selector update, ordered moves, reload, remove and reset', async ({ page }) => {
  const input = await settings(page);
  const files = await Promise.all([synthetic(page, '#f00'), synthetic(page, '#00f')]);
  const requests: string[] = []; page.on('request', request => { if (!request.url().startsWith('blob:') && !request.url().startsWith('data:')) requests.push(request.url()); });
  await page.locator('.mes-trigger').click();
  await input.setInputFiles(files);
  await expect(page.getByRole('status')).toContainText('已保存 2 张');
  const previews = page.locator('.mes-portraits img');
  await expect(previews).toHaveCount(2);
  const first = await previews.nth(0).getAttribute('src'), second = await previews.nth(1).getAttribute('src');
  expect(first).not.toBe(second);
  await expect(page.locator('.mes-thumb img')).toHaveAttribute('src', second!);
  await expect(page.locator('.mes-pointer')).toHaveCount(0);
  await expect(page.locator('.mes-thumb[data-image]')).toHaveCount(1);
  expect(await page.locator('.mes-thumb').evaluate(node => getComputedStyle(node).boxShadow)).not.toBe('none');
  await page.getByRole('dialog').press('Escape');
  await page.getByRole('button', { name: '前移图片 2' }).click();
  await expect(previews.nth(0)).toHaveAttribute('src', second!);
  await page.locator('.mes-trigger').click();
  await expect(page.locator('.mes-thumb img')).toHaveAttribute('src', first!);
  expect(requests).toEqual([]);
  await page.reload(); await settings(page);
  await expect(previews).toHaveCount(2); await expect(previews.nth(0)).toHaveAttribute('src', second!);
  await page.getByRole('button', { name: '移除图片 1' }).click(); await expect(previews).toHaveCount(1);
  await page.locator('.mes-trigger').click(); await expect(page.locator('.mes-thumb img')).toHaveAttribute('src', first!);
  await page.getByRole('dialog').press('Escape');
  await page.getByRole('button', { name: '重置为纯色滑块' }).click();
  await expect(previews).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  await page.locator('.mes-trigger').click(); await expectNoPortrait(page);
  await page.reload(); await page.locator('.mes-trigger').click(); await expectNoPortrait(page);
});

test('image load failure removes the frame without a pointer', async ({ page }) => {
  const input = await settings(page);
  await input.setInputFiles(await synthetic(page));
  await expect(page.locator('.mes-portraits img')).toHaveCount(1);
  await page.locator('.mes-trigger').click();
  await expect(page.locator('.mes-thumb[data-image]')).toHaveCount(1);
  await page.locator('.mes-thumb img').dispatchEvent('error');
  await expectNoPortrait(page);
});

test('enforces six portraits and accessible keyboard reordering', async ({ page }) => {
  const input = await settings(page); const file = await synthetic(page);
  await input.setInputFiles(Array(7).fill(file)); await expect(page.getByRole('alert')).toContainText('最多保存六张');
  await expect(page.locator('.mes-portraits img')).toHaveCount(0);
  await input.setInputFiles(Array(6).fill(file)); await expect(page.locator('.mes-portraits img')).toHaveCount(6);
  await expect(input).toBeDisabled();
  await expect(page.getByRole('button', { name: '前移图片 1' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '后移图片 6' })).toBeDisabled();
  const move = page.getByRole('button', { name: '后移图片 1' }); await move.focus(); await move.press('Enter');
  await expect(page.getByRole('status')).toContainText('已移至位置 2');
  await page.getByRole('button', { name: '移除图片 6' }).click(); await expect(input).toBeEnabled();
});

test('validates MIME, file size, signatures, decode and dimensions without partially saving', async ({ page }) => {
  const input = await settings(page), valid = await synthetic(page);
  for (const [file, error] of [
    [{ name: 'vector.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') }, '不支持 SVG'],
    [{ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(MAX_FILE_BYTES + 1) }, '2 MiB'],
    [{ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) }, '2 MiB'],
    [{ name: 'spoof.png', mimeType: 'image/png', buffer: Buffer.from('not a png') }, '不匹配'],
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
  for (const image of await page.locator('.mes-portraits img').all()) await expect(image).toHaveAttribute('src', /^data:image\/png;base64,/);
});

test('quota failure is visible and preserves saved portraits; corrupted storage can be reset', async ({ page }) => {
  const input = await settings(page); await input.setInputFiles(await synthetic(page));
  await expect(page.locator('.mes-portraits img')).toHaveCount(1);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota', 'QuotaExceededError'); }; });
  await input.setInputFiles(await synthetic(page, '#f00'));
  await expect(page.getByRole('alert')).toContainText('无法保存'); await expect(page.locator('.mes-portraits img')).toHaveCount(1);
  await page.reload();
  await page.evaluate(key => localStorage.setItem(key, '{bad data'), STORAGE_KEY); await page.reload(); await settings(page);
  await expect(page.getByRole('alert')).toContainText('无法读取'); await expect(page.locator('.mes-portraits img')).toHaveCount(0);
  await page.getByRole('button', { name: '重置为纯色滑块' }).click(); await expect(page.getByRole('alert')).toHaveCount(0);
});

test('denied localStorage keeps plain selector usable and reports an accessible settings error', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Denied', 'SecurityError'); } }); });
  await page.reload(); await settings(page);
  await expect(page.getByRole('alert')).toContainText('无法读取');
  await page.locator('.mes-trigger').click(); await expect(page.getByRole('slider')).toBeVisible(); await expect(page.locator('.mes-thumb img')).toHaveCount(0);
});

test('cross-tab uploads and reset update an already open selector live', async ({ page, context }) => {
  await page.locator('.mes-trigger').click();
  const other = await context.newPage(); await other.goto('/');
  const input = await settings(other); await input.setInputFiles(await synthetic(other));
  await expect(page.locator('.mes-thumb img')).toHaveCount(1);
  await other.getByRole('button', { name: '重置为纯色滑块' }).click(); await expect(page.locator('.mes-thumb img')).toHaveCount(0);
  await other.close();
});
