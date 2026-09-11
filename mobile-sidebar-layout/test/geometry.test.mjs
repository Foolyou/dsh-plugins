import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeColumns, clampWidth, drawerWidth } from '../src/geometry.js';
import { layoutSpec } from '../src/store.js';
import { LayoutController } from '../src/service.js';
function original(viewport, sidebar, rightbar) {
  const s = sidebar === 0 ? 56 : clampWidth(sidebar, 264, 420);
  const available = viewport - s - 400;
  const r = rightbar === 0 || available < 300 ? 0 : Math.min(available, clampWidth(rightbar, 300, viewport * .7));
  return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r };
}
test('desktop solver matches baseline across preferences and breakpoint boundaries', () => {
  for (const v of [768, 800, 1023, 1024, 1280, 1920, 2560])
    for (const s of [0, 1, 264, 280, 420, 1000])
      for (const r of [0, 1, 300, 500, 3000]) assert.deepEqual(computeColumns(v, s, r), original(v, s, r));
});
test('mobile never reserves any sidebar track; open and closed center identical', () => {
  for (const v of [240, 320, 375, 390, 430, 600, 767]) {
    assert.deepEqual(computeColumns(v, 0, 0), { sidebar: 0, center: v, rightbar: 0 });
    assert.deepEqual(computeColumns(v, 280, 0), computeColumns(v, 0, 0));
    assert.equal(computeColumns(v, 420, 500).sidebar, 0);
    assert.ok(drawerWidth(v, 420) <= v - 48);
  }
});
test('store preserves native desktop/narrow toggle and rightbar transitions', () => {
  const { init, actions: a } = layoutSpec(1280), d = init();
  a.setSidebar(d, 340); a.toggleSidebar(d); assert.equal(d.layoutInfo.sidebar, 0);
  a.toggleSidebar(d); assert.equal(d.layoutInfo.sidebar, 280);
  a.setViewportWidth(d, 800); assert.equal(d.layoutInfo.narrowExpanded, false);
  a.toggleSidebar(d); assert.equal(d.layoutInfo.narrowExpanded, true);
  a.setViewportWidth(d, 767); assert.equal(d.layoutInfo.narrowExpanded, false);
  a.toggleSidebar(d); a.openRightbar(d, true, false);
  assert.equal(d.layoutInfo.narrowExpanded, false); assert.equal(d.layoutInfo.rightbar, 345);
  a.openRightbar(d, true, true); a.openRightbar(d, true, false);
  assert.equal(d.layoutInfo.rightbarInstant, true);
  a.closeRightbar(d); assert.equal(d.layoutInfo.rightbarShown, false);
  a.setRightbar(d, 9000); assert.equal(d.layoutInfo.rightbar, 767 * .7);
});
test('controller exports compatible actions, validates panels, cancels navigation', () => {
  const calls = [];
  const layout = new LayoutController({ selectPanel: v => calls.push(v), toggleSidebar: () => calls.push('toggle'),
    openRightbar: (...v) => calls.push(v), closeRightbar: () => calls.push('close') }, id => id === 'settings');
  assert.throws(() => layout.selectPanel('missing'), /not registered/);
  const signal = layout.beginNavigation(); layout.selectPanel('settings'); assert.equal(signal.aborted, true);
  layout.selectPanel(null); layout.toggleSidebar(); layout.openRightbar(true, false); layout.closeRightbar();
  assert.deepEqual(calls, ['settings', null, 'toggle', [true, false], 'close']);
  const final = layout.beginNavigation(); layout.dispose(); assert.equal(final.aborted, true);
});
