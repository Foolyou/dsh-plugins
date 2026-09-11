import { Selector, type SelectorProps } from './Selector';
import { PortraitSettings } from './PortraitSettings';
import type { Directory } from './model';
import sliderCss from 'node-slider/style.css';
import css from './style.css';

// Minimal structural service face; native DSH owns the directory and its lifetime.
interface Context {
  modelDirectories: { directoryFor(id: string): Directory };
  sessions: { subagentAddress(id: string): unknown };
  effect(fn: () => () => void, label?: string): void;
  slots: {
    inject(name: string, fn: () => () => void): void;
    register(options: { name: 'conversation.input.model'; priority: number; inject(id: string): Omit<SelectorProps, 'locked'> }, component: typeof Selector): () => void;
    register(options: { name: 'settings.section'; id: string; order: number; label(): string }, component: typeof PortraitSettings): () => void;
  };
}
export const name = 'model-effort-slider';
export const inject = ['slots', 'sessions', 'modelDirectories', 'remote', 'remote.session'];
export function apply(ctx: Context) {
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = 'dsh-model-effort-slider';
    style.textContent = sliderCss + '\n' + css;
    document.head.append(style);
    return () => style.remove();
  }, 'model-effort-slider styles');
  ctx.slots.inject('conversation.input.model', () => ctx.slots.register({
    name: 'conversation.input.model', priority: -10,
    inject: sessionId => ({ directory: ctx.modelDirectories.directoryFor(sessionId), available: ctx.sessions.subagentAddress(sessionId) === undefined }),
  }, Selector));
  // Installed ui-settings-general declares this root list; the shell supplies close().
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'model-effort-slider', order: 36, label: () => '推理滑块图片',
  }, PortraitSettings));
}
