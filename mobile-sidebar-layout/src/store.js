// Forked from @deepseek-ai/dsh-client-ui-layout 0.1.5-rc.1, MIT © 2026 DeepSeek.
import { clampWidth, RIGHTBAR_MAX_RATIO, RIGHTBAR_DEFAULT_RATIO, MOBILE_BREAKPOINT } from './geometry.js';
// Kept separate from defineStore so the exact reducers can be tested in Node.
export function layoutSpec(viewportWidth) {
  return {
    init: () => ({
      panelInfo: { activePanelId: null },
      layoutInfo: { sidebar: 280, viewportWidth, narrowExpanded: false, rightbar: null,
        rightbarShown: false, rightbarTrack: false, rightbarFullscreen: false, rightbarInstant: false }
    }),
    actions: {
      selectPanel(d, panelId) { d.panelInfo.activePanelId = panelId; },
      retainMainPanels(d, panelIds) {
        if (d.panelInfo.activePanelId !== null && !panelIds.includes(d.panelInfo.activePanelId)) d.panelInfo.activePanelId = null;
      },
      setSidebar(d, px) {
        d.layoutInfo.rightbarInstant = false;
        d.layoutInfo.sidebar = clampWidth(px, 264, 420);
      },
      toggleSidebar(d) {
        d.layoutInfo.rightbarInstant = false;
        if (d.layoutInfo.viewportWidth < 1024) d.layoutInfo.narrowExpanded = !d.layoutInfo.narrowExpanded;
        else d.layoutInfo.sidebar = d.layoutInfo.sidebar === 0 ? 280 : 0;
      },
      setViewportWidth(d, width) {
        if (d.layoutInfo.viewportWidth === width) return;
        d.layoutInfo.rightbarInstant = false;
        // Reset the override at either presentation boundary (desktop is otherwise unchanged).
        if ((d.layoutInfo.viewportWidth < 1024) !== (width < 1024) ||
            (d.layoutInfo.viewportWidth < MOBILE_BREAKPOINT) !== (width < MOBILE_BREAKPOINT)) d.layoutInfo.narrowExpanded = false;
        d.layoutInfo.viewportWidth = width;
      },
      setRightbar(d, px) {
        d.layoutInfo.rightbarInstant = false;
        d.layoutInfo.rightbar = clampWidth(px, 300, Math.max(300, d.layoutInfo.viewportWidth * RIGHTBAR_MAX_RATIO));
      },
      openRightbar(d, track, fullscreen) {
        const l = d.layoutInfo;
        if (!l.rightbarShown || l.rightbarTrack !== track || l.rightbarFullscreen !== fullscreen) l.rightbarInstant = l.rightbarFullscreen && !fullscreen;
        if (!l.rightbarShown && l.viewportWidth < 1024) l.narrowExpanded = false;
        l.rightbar ??= Math.max(300, Math.round(l.viewportWidth * RIGHTBAR_DEFAULT_RATIO));
        l.rightbarShown = true;
        l.rightbarTrack = track;
        l.rightbarFullscreen = fullscreen;
      },
      closeRightbar(d) {
        const l = d.layoutInfo;
        if (l.rightbarShown) l.rightbarInstant = l.rightbarFullscreen;
        l.rightbarShown = false;
        l.rightbarTrack = false;
        l.rightbarFullscreen = false;
      }
    }
  };
}
