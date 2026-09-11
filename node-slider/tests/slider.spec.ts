import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/react.html'); });

test('controlled selection follows left interval and next activation area; commits on release', async ({ page }) => {
  const slider = page.getByRole('slider', { name:'节奏', exact:true });
  const rect = (await slider.boundingBox())!;
  await page.mouse.click(rect.x + rect.width * .20, rect.y + rect.height / 2);
  await expect(slider).toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByTestId('commit')).toHaveText('rest');
  await page.mouse.click(rect.x + rect.width * .25 - 8, rect.y + rect.height / 2);
  await expect(slider).toHaveAttribute('aria-valuenow', '1');
  await expect(page.getByTestId('value')).toHaveText('easy');
});

test('dragging clamps outside track and updates custom components', async ({ page }) => {
  const slider = page.getByRole('slider', { name:'节奏', exact:true });
  const rect = (await slider.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width + 40, rect.y + rect.height / 2);
  await page.mouse.up();
  await expect(slider).toHaveAttribute('aria-valuenow', '4');
  await expect(slider.locator('.custom-thumb')).toHaveAttribute('data-icon', '∞');
  await expect(page.getByTestId('commit')).toHaveText('flow');
});

test('keyboard, disabled state and replacement components preserve accessibility', async ({ page }) => {
  const slider = page.getByRole('slider', { name:'节奏', exact:true });
  await slider.focus(); await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuenow', '0');
  await page.keyboard.press('End'); await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuetext', '投入');
  await page.getByLabel('自定义组件').uncheck();
  await expect(slider.locator('.ns-default-thumb')).toHaveCount(1);
  await page.getByLabel('禁用', { exact:true }).check();
  await expect(slider).toHaveAttribute('tabindex', '-1');
  await slider.dispatchEvent('keydown', { key:'Home' });
  await expect(slider).toHaveAttribute('aria-valuenow', '3');
});

test('semicircle geometry and empty/full endpoints remain correct at a custom height', async ({ page }) => {
  const slider = page.getByRole('slider', { name:'紧凑节奏', exact:true });
  await slider.focus(); await page.keyboard.press('Home');
  await page.waitForTimeout(350);
  const geometry = await slider.evaluate(element => {
    const rail = element.querySelector('.ns-rail')!;
    return { control:element.getBoundingClientRect().width, width:rail.getBoundingClientRect().width,
      radius:getComputedStyle(rail).borderRadius, fill:element.querySelector('.ns-fill')!.getBoundingClientRect().width };
  });
  expect(geometry.width - geometry.control).toBeCloseTo(22);
  expect(geometry.radius).toBe('5px'); expect(geometry.fill).toBe(0);
  await page.keyboard.press('End'); await page.waitForTimeout(350);
  const widths = await slider.evaluate(element => [...element.querySelectorAll('.ns-rail, .ns-fill')].map(node => node.getBoundingClientRect().width));
  expect(widths[0]).toBeCloseTo(widths[1]!);
});

test('hover state reaches custom nodes and reduced motion disables animations', async ({ page }) => {
  const slider = page.getByRole('slider', { name:'节奏', exact:true });
  const rect = (await slider.boundingBox())!;
  await page.mouse.move(rect.x + rect.width * .25, rect.y + rect.height / 2);
  await expect(slider.locator('.ns-node').nth(1)).toHaveAttribute('data-hovered', 'true');
  await expect(slider.locator('.diamond-node').nth(1)).toHaveAttribute('style', /scale\(1.6\)/);
  await page.emulateMedia({ reducedMotion:'reduce' });
  expect(await slider.locator('.ns-fill').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
});

test('tooltips immediately name physical nodes without selection or commit', async ({ page }) => {
  const slider = page.getByRole('slider', { name:'节奏', exact:true });
  const rect = (await slider.boundingBox())!;
  for (const [at, name] of ['休憩', '轻松', '专注', '投入', '心流'].entries()) {
    // Only React's next render is needed: no native title or tooltip delay.
    await page.mouse.move(rect.x + rect.width * at / 4, rect.y + rect.height / 2);
    await expect(page.getByRole('tooltip')).toHaveText(name, { timeout:500 });
  }
  await expect(slider).toHaveAttribute('aria-valuenow', '2');
  await expect(page.getByTestId('commit')).toHaveText('尚未提交');
  await expect(page.getByTestId('value')).toHaveText('focus');
  await page.mouse.move(rect.x + rect.width * .12, rect.y + rect.height / 2);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.mouse.move(rect.x + rect.width / 4, rect.y + rect.height / 2);
  await expect(page.getByRole('tooltip')).toHaveText('轻松');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('keyboard descriptions, custom tooltip, cancellation, opt-out and disabled', async ({ page }) => {
  const slider = page.getByRole('slider', { name:'Tooltip fixture' });
  await slider.focus();
  await expect(page.getByRole('tooltip')).toHaveText('休憩');
  const id = await page.getByRole('tooltip').getAttribute('id');
  await expect(slider).toHaveAttribute('aria-describedby', `tooltip-help ${id}`);
  await page.keyboard.press('End');
  await expect(page.getByRole('tooltip')).toHaveText('心流');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(slider).toHaveAttribute('aria-describedby', 'tooltip-help');
  await page.getByLabel('Custom tooltip', { exact:true }).check();
  await page.keyboard.press('Tab'); // Switch back from pointer modality.
  await slider.focus();
  await expect(page.getByRole('tooltip')).toHaveText('Custom: 心流');
  await slider.dispatchEvent('pointercancel', { pointerId:1 });
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByLabel('Tooltips', { exact:true }).uncheck();
  await slider.focus();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  const optedOutRect = (await slider.boundingBox())!;
  await page.mouse.move(optedOutRect.x + optedOutRect.width / 4, optedOutRect.y + optedOutRect.height / 2);
  await expect(slider.locator('.ns-node').nth(1)).toHaveAttribute('data-hovered', 'true');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByLabel('禁用', { exact:true }).check();
  const disabled = page.getByRole('slider', { name:'节奏', exact:true });
  const rect = (await disabled.boundingBox())!;
  await page.mouse.move(rect.x, rect.y + rect.height / 2);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('dynamic nodes clear stale hover and long names stay within container', async ({ page }) => {
  const slider = page.getByRole('slider', { name:'Tooltip fixture' });
  await slider.scrollIntoViewIfNeeded();
  const rect = (await slider.boundingBox())!;
  await page.mouse.move(rect.x + rect.width, rect.y + rect.height / 2);
  await expect(page.getByRole('tooltip')).toHaveText('心流');
  // Change nodes without moving the pointer or blurring the slider.
  await page.getByLabel('Fewer nodes').evaluate((element: HTMLInputElement) => element.click());
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByLabel('Long label').check();
  await page.setViewportSize({ width:375, height:812 });
  await page.keyboard.press('Tab');
  await slider.focus();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('休憩 long-name');
  const box = (await tooltip.boundingBox())!;
  const control = (await slider.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(control.x - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(control.x + control.width + 1);
  expect(await tooltip.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
  await page.getByLabel('Long label').focus();
  await expect(tooltip).toHaveCount(0);
});

test('narrow viewport has no horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width:375, height:812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('endpoint icons have symmetric breathing room and extended caps remain clickable', async ({ page }) => {
  const slider = page.getByRole('slider', { name:'节奏', exact:true });
  const rail = (await slider.locator('.ns-rail').boundingBox())!;
  const icons = slider.locator('.diamond-node');
  const first = (await icons.first().boundingBox())!;
  const last = (await icons.last().boundingBox())!;
  const leftGap = first.x - rail.x;
  const rightGap = rail.x + rail.width - last.x - last.width;
  expect(leftGap).toBeGreaterThan(8);
  expect(rightGap).toBeCloseTo(leftGap, 1);
  await page.mouse.click(rail.x + rail.width - 1, rail.y + rail.height / 2);
  await expect(slider).toHaveAttribute('aria-valuenow', '4');
  await page.mouse.click(rail.x + 1, rail.y + rail.height / 2);
  await expect(slider).toHaveAttribute('aria-valuenow', '0');
});
