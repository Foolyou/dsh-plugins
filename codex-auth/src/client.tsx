import { AuthPanel } from './AuthPanel';
import css from './style.css';
interface Context {
  effect(fn: () => () => void, label?: string): void;
  slots: { inject(name: string, fn: () => () => void): void;
    register(options: { name: string; id: string; order: number; label(): string }, component: typeof AuthPanel): () => void };
}
export const name = 'codex-auth';
export const inject = ['slots'];
export function apply(ctx: Context) {
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = 'dsh-codex-auth'; style.textContent = css; document.head.append(style); return () => style.remove(); }, 'codex-auth styles');
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'codex-auth', order: 35, label: () => 'Codex 授权' }, AuthPanel));
}
