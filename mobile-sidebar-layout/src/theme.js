// Forked from @deepseek-ai/dsh-client-ui-layout 0.1.5-rc.1, MIT © 2026 DeepSeek.
export class ThemePresenter {
  appliedTokens = [];
  constructor() { this.themeColorMeta = document.createElement('meta'); this.themeColorMeta.name = 'theme-color'; }
  apply(snapshot) {
    const scheme = snapshot.active.colorScheme;
    document.documentElement.style.colorScheme = scheme;
    const body = document.body;
    if (scheme === 'dark') body.setAttribute('data-ds-dark-theme', '');
    else body.removeAttribute('data-ds-dark-theme');
    body.style.setProperty('--dsh-content-font-size', `${snapshot.fontSize}px`);
    for (const name of this.appliedTokens) body.style.removeProperty(name);
    this.appliedTokens = [];
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      body.style.setProperty(name, value); this.appliedTokens.push(name);
    }
    this.themeColorMeta.content = getComputedStyle(body).backgroundColor;
    if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);
  }
  dispose() {
    document.documentElement.style.removeProperty('color-scheme');
    const body = document.body;
    body.removeAttribute('data-ds-dark-theme'); body.style.removeProperty('--dsh-content-font-size');
    for (const name of this.appliedTokens) body.style.removeProperty(name);
    this.appliedTokens = []; this.themeColorMeta.remove();
  }
}
