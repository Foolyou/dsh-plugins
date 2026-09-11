// Independent fork of @deepseek-ai/dsh-client-ui-layout 0.1.5-rc.1, MIT © 2026 DeepSeek.
import { defineStore } from '@deepseek-ai/dsh-client-store';
import { layoutSpec } from './store.js';
import { LayoutController } from './service.js';
import { ThemePresenter } from './theme.js';
import { AppFrame } from './frame.jsx';
import css from './style.css';
export { LayoutController };
export const inject = ['slots', 'theme', 'locale'];
export function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = '@deepseek-ai/dsh-client-ui-layout';
    style.dataset.pluginCss = 'mobile-sidebar-layout/style.css';
    style.textContent = css; document.head.append(style);
    return () => style.remove();
  }, 'mobile-sidebar-layout: stylesheet');
  ctx.effect(() => {
    const handle = defineStore(layoutSpec(window.innerWidth));
    const instance = handle.create();
    const store = { ...handle, create: () => instance };
    const layout = new LayoutController(instance.actions, id => ctx.slots.entries('main').some(entry => entry.options.key === id));
    const retainMainPanels = () => instance.actions.retainMainPanels(ctx.slots.entries('main').flatMap(entry => entry.options.key === undefined ? [] : [entry.options.key]));
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: {
      getSnapshot: () => instance.getSnapshot().panelInfo,
      subscribe: listener => instance.subscribe(listener)
    } } });
    const disposeService = ctx.reflect.provide('layout', layout);
    const disposeRegistration = ctx.slots.register({ name: 'root', locale: 'common', children: {
      sidebar: { kind: 'single', scope: 'root' }, main: { kind: 'keyed', scope: 'root' },
      rightbar: { kind: 'single', scope: 'root' }, 'shell.overlay': { kind: 'list', scope: 'root' }
    }, store }, AppFrame);
    const disposePanels = ctx.slots.subscribe('main', retainMainPanels);
    retainMainPanels();
    return () => { layout.dispose(); disposePanels(); disposeRegistration(); disposePanelInfo(); disposeService(); };
  }, 'ui-layout: service + root registration');
  ctx.effect(() => {
    const presenter = new ThemePresenter(); presenter.apply(ctx.theme.getTheme());
    const off = ctx.on('theme/change', snapshot => presenter.apply(snapshot));
    return () => { off(); presenter.dispose(); };
  }, 'ui-layout: theme presenter');
}
