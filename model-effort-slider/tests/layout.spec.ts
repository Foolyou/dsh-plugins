import { test, expect, type Page } from '@playwright/test';
import { uploadTestImage } from './image-helpers';

async function geometry(page: Page) {
  return page.locator('.mes-panel').evaluate(panel => {
    const heading = panel.querySelector('.mes-heading')!.getBoundingClientRect();
    const rail = panel.querySelector('.ns-rail')!.getBoundingClientRect();
    const slider = panel.querySelector('.mes-slider')!;
    return { gap: rail.top - heading.bottom, height: panel.getBoundingClientRect().height,
      margin: parseFloat(getComputedStyle(slider).marginTop) };
  });
}
for (const width of [375, 960]) {
  test(`image space adapts to upload, load failure and removal at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.goto('/');
    await page.locator('.mes-trigger').click();
    await expect(page.locator('.mes-panel')).toBeVisible();
    const compact = await geometry(page);
    expect(compact.margin).toBe(8);
    expect(compact.gap).toBeLessThan(24);
    await expect(page.locator('.mes-slider .ns-thumb')).toBeHidden();

    await uploadTestImage(page);
    const expanded = await geometry(page);
    expect(expanded.gap - compact.gap).toBeGreaterThan(30);
    expect(expanded.height - compact.height).toBeGreaterThan(30);
    const heading = (await page.locator('.mes-heading').boundingBox())!;
    const image = (await page.locator('.mes-thumb').boundingBox())!;
    const rail = (await page.locator('.ns-rail').boundingBox())!;
    expect(image.y - (heading.y + heading.height)).toBeGreaterThanOrEqual(5);
    expect(image.y + image.height).toBeLessThanOrEqual(rail.y);

    // A failed image must collapse the actual rendered area without a settings round-trip.
    await page.locator('.mes-thumb img').dispatchEvent('error');
    await expect(page.locator('.ns-thumb')).toBeHidden();
    expect((await geometry(page)).gap).toBeCloseTo(compact.gap, 1);

    await page.getByRole('dialog').press('Escape');
    await page.getByRole('button', { name: '推理滑块图片', exact: true }).click();
    await page.getByRole('button', { name: '移除图片 1', exact: true }).click();
    await expect(page.locator('.mes-portraits img')).toHaveCount(0);
    await page.getByRole('button', { name: '推理滑块图片', exact: true }).click();
    await page.locator('.mes-trigger').click();
    expect((await geometry(page)).gap).toBeCloseTo(compact.gap, 1);

    // Hiding the unused image target must not remove visible keyboard focus or interaction.
    const slider = page.getByRole('slider');
    await slider.press('Home');
    await expect(slider).toHaveAttribute('aria-valuetext', 'OFF');
    await expect(slider).not.toHaveAttribute('aria-disabled', 'true');
    expect(await page.locator('.ns-rail').evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
  });
}
