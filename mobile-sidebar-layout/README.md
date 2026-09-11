# Mobile sidebar layout

手机端贴边展开按钮：左侧 **24×44px** 窄短按钮以右箭头表示展开原生侧栏，位于顶部下方 88px（加安全区偏移）。不预留顶部或左侧空间，桌面布局不变。中文安装、配置验证与回滚见 [DEPLOYMENT.md](DEPLOYMENT.md)。

An independent, persistent replacement for the DeepSeek Harness layout plugin. No official package is modified or read at runtime/build time. The readable source fork retains the MIT license and is based on `@deepseek-ai/dsh-client-ui-layout` **0.1.5-rc.1** (installed 577-line client bundle).

## Behavior

- **Mobile: frame width below 768px (through 767px).** The sidebar consumes **zero grid width** when closed *or open*. A 24×44px left-edge tab with a right-pointing chevron opens the native sidebar in an overlay drawer; backdrop, Escape, or its native collapse button closes it.
- The native sidebar slot stays mounted and receives expanded props on mobile, including while hidden. Its wrapper is `inert` and `aria-hidden` when closed. Center/rightbar are inert while the drawer is open. Drawer focus is contained, returned to the persistent floating button on close, and yields to higher native overlays/portals. An owned subtree observer reveals native descendant dialogs mounted while closed (including onboarding or settings surviving a desktop-to-mobile resize); it never manipulates official DOM outside the registered frame.
- Drawer/backdrop z-indices 15/14 remain below the native `shell.overlay` layer (20). Safe-area insets protect the trigger and drawer contents. The mobile center reserves no space for the trigger and keeps its full width and height. The narrow edge tab sits 88px below the safe-area top to stay away from the upper-left title controls; as an overlay, it can still cover content directly underneath its small footprint. Mobile resize handles are suppressed. No animation is introduced for the mobile drawer.
- **Desktop: 768px and above.** The original track solver, 56px collapsed rail, 264–420px sidebar resize range, rightbar sizing/fullscreen/instant behavior, and **1024px** narrow auto-collapse threshold remain. Crossing the new mobile boundary resets the narrow expansion override.
- Original layout store, `LayoutController`, root/main/sidebar/rightbar/overlay slot contracts, navigation cancellation, document title, and theme presenter are retained. Styles now retract with the plugin lifecycle.

## Build and tests

```sh
npm ci
npm run build
npm test
# Uses the installed /opt/google/chrome/chrome by default; override as needed:
CHROME_PATH=/opt/google/chrome/chrome npm run test:browser
```

`lib/client.js` and `lib/index.js` are generated from checked-in source, without importing the original layout package. The client external dependencies are the harness-provided React runtime and `@deepseek-ai/dsh-client-store`. The fixture bundles its own development React and exercises the real fork frame, reducers and theme presenter with **mock slot occupants**, not the production GUI. It starts a bounded loopback server on an ephemeral port and closes it/browser in `finally`. Unit tests exhaustively compare desktop geometry with the baseline and cover mobile geometry, reducers and controller navigation. Browser tests cover drawer state retention, inertness, focus wrapping/restoration, native-like collapse, higher settings portals, breakpoints, desktop dragging/rightbar, title/theme and unmount.

## Module identity and deployment

The private package intentionally retains manifest name and browser module ID **`@deepseek-ai/dsh-client-ui-layout`**: existing client dependency edges and exported controller imports use that identity. `private: true` prevents accidental publication under the official name. This is an independent source implementation, **not** a wrapper around the installed layout.

Load `/absolute/path/to/dsh-plugins/mobile-sidebar-layout/lib/index.js` by **absolute path** in user config and **replace/disable the official layout row**, never mount both. A bare package alias does not work: the loader checks the discovered package name against bare specifiers, while an absolute host-entry path discovers the compatible manifest correctly. Host entry is intentionally a no-op. The deployment procedure is documented separately in [DEPLOYMENT.md](DEPLOYMENT.md); changing the module graph requires refreshing the existing GUI after the approved profile change.

## Fork limitations

This fork is pinned to the above baseline, not automatically synchronized with official upgrades. Re-review client contracts, theme/slot behavior and module identity before upgrading Harness. The fixture targets React 18 (including string-form `inert`). The component fixture cannot establish compatibility with every third-party overlay; the focus handler deliberately yields when focus belongs to another overlay outside the drawer rather than globally trapping all document focus. Actual native sidebar/settings behavior must be verified separately on your deployment; fixture coverage is not a production verification report. English accessible labels are currently local to the new trigger/drawer; the reused native sidebar retains its own locale support.
