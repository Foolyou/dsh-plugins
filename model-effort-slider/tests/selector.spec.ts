import { test, expect } from '@playwright/test';
import { uploadTestImage } from './image-helpers';
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.locator('.mes-trigger').click(); });
test('dragging the uploaded image edge preserves selection until movement and commits once', async ({ page }) => {
  await uploadTestImage(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const slider = page.getByRole('slider');
  const portrait = (await page.locator('.mes-thumb').boundingBox())!;
  const rail = (await slider.boundingBox())!;
  const x = portrait.x + 3, y = portrait.y + portrait.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await expect(slider).toHaveAttribute('aria-valuetext', 'HIGH');
  await page.mouse.move(x + rail.width / 3, y - 12, { steps: 5 });
  await expect(slider).toHaveAttribute('aria-valuetext', 'MAX');
  expect(await page.evaluate(() => (window as any).fixture.calls.length)).toBe(0);
  await page.mouse.up();
  await expect(page.locator('.mes-trigger-effort')).toHaveText('MAX');
  expect(await page.evaluate(() => (window as any).fixture.calls.length)).toBe(1);
});
test('touch dragging the uploaded image captures movement outside the track', async ({ page }) => {
  await uploadTestImage(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const slider = page.getByRole('slider');
  const portrait = (await page.locator('.mes-thumb').boundingBox())!;
  const rail = (await slider.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const point = { x: portrait.x + portrait.width / 2, y: portrait.y + portrait.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rail.x, y: point.y + 20 }] });
  await expect(slider).toHaveAttribute('aria-valuetext', 'OFF');
  expect(await page.evaluate(() => (window as any).fixture.calls.length)).toBe(0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.mes-trigger-effort')).toHaveText('OFF');
  expect(await page.evaluate(() => (window as any).fixture.calls.length)).toBe(1);
  await cdp.detach();
});
test('fill cap covers every selected dot including the first, last stop stays full', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const slider = page.getByRole('slider');
  for (const key of ['Home', 'ArrowRight', 'ArrowRight', 'End']) {
    await slider.press(key);
    await expect(slider).not.toHaveAttribute('aria-disabled', 'true');
    const geometry = await slider.evaluate(element => {
      const fill = element.querySelector('.ns-fill')!.getBoundingClientRect();
      const rail = element.querySelector('.ns-rail')!.getBoundingClientRect();
      const dot = element.querySelector('.ns-node[data-selected] .ns-default-node')!.getBoundingClientRect();
      return { fillWidth: fill.width, railWidth: rail.width, fillRight: fill.right, dotRight: dot.right, dotCenter: (dot.left + dot.right) / 2, radius: rail.height / 2 };
    });
    if (key === 'End') expect(geometry.fillWidth).toBeCloseTo(geometry.railWidth, 1);
    else {
      expect(geometry.fillRight).toBeGreaterThan(geometry.dotRight);
      expect(geometry.fillRight - geometry.dotCenter).toBeCloseTo(geometry.radius, 1);
    }
  }
});
test('drag previews locally, release submits once, rejected selection rolls back', async ({ page }) => {
  const slider = page.getByRole('slider');
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width * 2 / 3, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width, box.y + box.height / 2);
  expect(await page.evaluate(() => (window as any).fixture.calls.length)).toBe(0);
  await page.mouse.up(); await expect(page.locator('.mes-trigger-effort')).toHaveText('MAX');
  expect(await page.evaluate(() => (window as any).fixture.calls)).toEqual([{ provider: 'alpha', model: 'four', reasoningEffort: 'max' }]);
  await page.evaluate(() => (window as any).fixture.reject());
  await slider.press('Home'); await expect(page.getByRole('alert')).toContainText('Provider rejected');
  await expect(slider).toHaveAttribute('aria-valuetext', 'MAX');
});
test('model/provider changes rebuild nodes and default sends no reasoningEffort', async ({ page }) => {
  await page.getByRole('button', { name: 'Custom provider', exact: true }).click();
  const slider = page.getByRole('slider');
  await expect(slider).toHaveAttribute('aria-valuemax', '2');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Default');
  await slider.press('End'); await expect(slider).toHaveAttribute('aria-valuetext', '深思');
  await expect(page.locator('.mes-trigger-effort')).toHaveText('深思');
  await page.getByRole('button', { name: '恢复模型默认推理等级' }).click();
  await expect(page.locator('.mes-trigger-effort')).toHaveText('Default');
  expect(await page.evaluate(() => (window as any).fixture.calls.at(-1))).toEqual({ provider: 'beta', model: 'custom' });
  await page.getByRole('button', { name: 'No effort', exact: true }).click();
  await expect(slider).toHaveCount(0);
  await page.getByRole('button', { name: 'Single level', exact: true }).click();
  await expect(slider).toHaveCount(0); await expect(page.locator('.mes-hint')).toContainText('Only');
});
test('node tooltip shows provider labels immediately without selecting or submitting', async ({ page }) => {
  const slider = page.getByRole('slider');
  const nodes = page.locator('.mes-slider .ns-node');
  for (const [index, label] of ['OFF', 'LOW', 'HIGH', 'MAX'].entries()) {
    const dot = (await nodes.nth(index).boundingBox())!;
    await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await expect(page.getByRole('tooltip')).toHaveText(label, { timeout: 500 });
    await expect(slider).toHaveAttribute('aria-valuetext', 'HIGH');
    await expect(page.locator('.mes-level')).toHaveText('HIGH');
    expect(await page.evaluate(() => (window as any).fixture.calls.length)).toBe(0);
  }
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 6, box.y + box.height / 2);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  const first = (await nodes.first().boundingBox())!;
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await expect(page.getByRole('tooltip')).toHaveText('OFF');
  // Focus the slider so Escape bubbles through its keyboard handler to the dialog.
  await slider.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('tooltip follows localized metadata after switching provider without extra business calls', async ({ page }) => {
  await page.getByRole('button', { name: 'Custom provider', exact: true }).click();
  const slider = page.getByRole('slider');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Default');
  await expect(slider).not.toHaveAttribute('aria-disabled', 'true');
  const calls = await page.evaluate(() => (window as any).fixture.calls.length);
  for (const [index, label] of ['Default', '浅思', '深思'].entries()) {
    const dot = (await page.locator('.mes-slider .ns-node').nth(index).boundingBox())!;
    await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await expect(page.getByRole('tooltip')).toHaveText(label, { timeout: 500 });
    await expect(slider).toHaveAttribute('aria-valuetext', 'Default');
  }
  expect(await page.evaluate(() => (window as any).fixture.calls.length)).toBe(calls);
});

test('mobile popup stays in viewport and Escape restores trigger focus', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(667);
  await panel.press('Escape'); await expect(panel).toHaveCount(0); await expect(page.locator('.mes-trigger')).toBeFocused();
});
