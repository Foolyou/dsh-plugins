// Forked from @deepseek-ai/dsh-client-ui-layout 0.1.5-rc.1, MIT © 2026 DeepSeek.
export const SIDEBAR_AUTO_COLLAPSE = 1024;
export const MOBILE_BREAKPOINT = 768; // Mobile includes 767px.
export const RIGHTBAR_MAX_RATIO = 0.7;
export const RIGHTBAR_DEFAULT_RATIO = 0.45;
export function clampWidth(px, min, max) {
  return Math.min(max, Math.max(min, Math.round(px)));
}
/** Original desktop track solver; mobile sidebar floats outside the grid. */
export function computeColumns(viewport, sidebar, rightbar) {
  const s = viewport < MOBILE_BREAKPOINT ? 0 : sidebar === 0 ? 56 : clampWidth(sidebar, 264, 420);
  const available = viewport - s - 400;
  const r = rightbar === 0 || available < 300 ? 0 : Math.min(available, clampWidth(rightbar, 300, viewport * RIGHTBAR_MAX_RATIO));
  return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r };
}
export function drawerWidth(viewport, preference) {
  return Math.max(0, Math.min(clampWidth(preference || 280, 264, 420), viewport - 48));
}
