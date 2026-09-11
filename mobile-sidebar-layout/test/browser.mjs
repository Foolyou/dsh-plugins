// Bounded isolated component test server; never connects to or modifies the production GUI.
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
await mkdir(artifacts, { recursive: true });
const bundle = await build({ entryPoints: [fileURLToPath(new URL('./fixture.jsx', import.meta.url))], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.css': 'text' } });
const server = createServer((req, res) => {
  res.setHeader('content-type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/fixture.js' ? bundle.outputFiles[0].text : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}body{--dsw-alias-bg-base:#fff;--dsw-specific-sidebar-fill:#eee;--dsw-alias-label-primary:#222;--dsw-alias-border-l3:#ccc;--ds-transition-duration-slow:0s}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const trigger = page.getByRole('button', {name:'Open sidebar'});
  await expect(trigger).toBeVisible();
  await expect(page.locator('.msl-sidebar')).toHaveAttribute('inert','');
  await expect(page.locator('.msl-sidebar')).toHaveAttribute('aria-hidden','true');
  await expect(page.locator('[data-native-sidebar]')).toHaveAttribute('data-collapsed','false');
  expect(await page.locator('.msl-center').boundingBox()).toMatchObject({x:0,width:390});
  expect(await trigger.boundingBox()).toMatchObject({x:0,y:88,width:24,height:44});
  await expect(trigger).toHaveAttribute('title', '展开侧栏');
  await expect(trigger.locator('svg path')).toHaveAttribute('d', 'm6 5 5 5-5 5');
  expect(await page.locator('main').boundingBox()).toMatchObject({x:0,y:0,width:390,height:844});
  await page.getByRole('button', { name: 'Main action' }).click();
  await expect(page.locator('.msl-handle')).toHaveCount(0);
  await page.screenshot({ path: `${artifacts}/mobile-closed.png` });
  await trigger.click();
  await expect(page.getByRole('dialog',{name:'Navigation'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Native collapse'})).toBeFocused();
  await expect(page.locator('.msl-center')).toHaveAttribute('inert','');
  await page.screenshot({ path: `${artifacts}/mobile-open.png` });
  expect(await page.locator('.msl-center').boundingBox()).toMatchObject({x:0,width:390});
  await page.getByRole('textbox',{name:'Sidebar draft'}).fill('preserve me');
  await page.getByRole('button',{name:'Native collapse'}).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button',{name:'Native collapse'})).toBeFocused();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('button',{name:'Close settings'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toHaveCount(0);
  await expect(page.getByRole('dialog',{name:'Navigation'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeVisible(); await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.getByRole('textbox',{name:'Sidebar draft'})).toHaveValue('preserve me');
  expect(await page.evaluate(() => window.mounts)).toBe(1);
  await page.locator('[data-mobile-backdrop]').click({position:{x:380,y:300}});
  await expect(trigger).toBeFocused();
  await trigger.click(); await page.getByRole('button',{name:'Native collapse'}).click();
  await expect(trigger).toBeVisible();
  // Exact mobile/desktop breakpoints and preserved 1024px auto-collapse.
  for (const width of [320,767,768,1023,1024,1440]) {
    await page.setViewportSize({width,height:844});
    await expect.poll(() => page.evaluate(() => window.fixture.getState().layoutInfo.viewportWidth)).toBe(width);
    if (width < 768) {
      await expect(trigger).toBeVisible();
      expect((await page.locator('.msl-center').boundingBox()).x).toBe(0);
      expect(await trigger.boundingBox()).toMatchObject({x:0,width:24,height:44});
      expect(await page.locator('main').boundingBox()).toMatchObject({x:0,y:0,width,height:844});
    }
    else {
      await expect(trigger).toHaveCount(0);
      expect((await page.locator('main').boundingBox()).y).toBe(0);
      expect((await page.locator('.msl-sidebar').boundingBox()).width).toBe(width < 1024 ? 56 : 280);
    }
  }
  await page.getByRole('button',{name:'Native collapse'}).click();
  expect((await page.locator('.msl-sidebar').boundingBox()).width).toBe(56);
  await page.getByRole('button',{name:'Native collapse'}).click();
  const handle = page.locator('[data-side="sidebar"]');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x+4,200); await page.mouse.down(); await page.mouse.move(box.x+64,200); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.fixture.getState().layoutInfo.sidebar)).toBe(340);
  await page.evaluate(() => window.fixture.actions.openRightbar(true,false));
  await expect(page.locator('[data-side="rightbar"]')).toHaveCount(1);
  expect((await page.locator('.msl-rightbar').boundingBox()).width).toBe(648);
  await page.evaluate(() => window.fixture.actions.openRightbar(true,true));
  await expect(page.locator('[data-side="rightbar"]')).toHaveCount(0);
  await page.evaluate(() => window.fixture.actions.closeRightbar());
  await expect(page).toHaveTitle('Fixture session — DeepSeek Harness');
  // A native fixed descendant modal must survive desktop -> closed-mobile presentation.
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('dialog',{name:'Navigation'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Close settings'})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button',{name:'Close settings'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Navigation'})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  // Startup/onboarding insertion while closed reveals its owner rather than hiding a modal under inert.
  await page.evaluate(() => window.fixture.showSettings());
  await expect(page.getByRole('button',{name:'Close settings'})).toBeFocused();
  await expect(page.getByRole('dialog',{name:'Navigation'})).toBeVisible();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  // Theme token updates/retraction are exercised without touching production.
  await page.evaluate(() => window.fixture.theme.apply({active:{colorScheme:'dark',tokens:{'--fixture-color':'red'}},fontSize:18}));
  await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme','');
  expect(await page.evaluate(() => document.body.style.getPropertyValue('--dsh-content-font-size'))).toBe('18px');
  await page.evaluate(() => window.fixture.theme.apply({active:{colorScheme:'light',tokens:{}},fontSize:16}));
  expect(await page.evaluate(() => document.body.style.getPropertyValue('--fixture-color'))).toBe('');
  await page.evaluate(() => {window.fixture.theme.dispose(); window.fixture.unmount();});
  expect(await page.evaluate(() => window.mounts)).toBe(0);
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(0);
  // Also exercise a body-portaled settings occupant: drawer must yield its focus/Escape.
  await page.goto(`http://127.0.0.1:${server.address().port}/?portal`);
  await trigger.click(); await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('button',{name:'Close settings'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Navigation'})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await page.evaluate(() => window.fixture.unmount());
  expect(errors).toEqual([]);
  console.log('PASS mobile geometry, drawer accessibility/focus/state, native collapse, nested/portal overlay precedence and breakpoint survival, desktop drag/rightbar, theme and unmount');
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
