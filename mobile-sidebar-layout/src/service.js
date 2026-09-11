// Forked from @deepseek-ai/dsh-client-ui-layout 0.1.5-rc.1, MIT © 2026 DeepSeek.
/** Compatible cross-plugin ctx.layout controller and exported class identity. */
export class LayoutController {
  navigation = new AbortController();
  constructor(panels, hasMainPanel) { this.panels = panels; this.hasMainPanel = hasMainPanel; }
  selectPanel(panelId) {
    if (panelId !== null && !this.hasMainPanel(panelId)) throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`);
    this.navigation.abort();
    this.panels.selectPanel(panelId);
  }
  beginNavigation() { this.navigation.abort(); this.navigation = new AbortController(); return this.navigation.signal; }
  dispose() { this.navigation.abort(); }
  toggleSidebar() { this.panels.toggleSidebar(); }
  openRightbar(track, fullscreen) { this.panels.openRightbar(track, fullscreen); }
  closeRightbar() { this.panels.closeRightbar(); }
}
