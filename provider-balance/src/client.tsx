import { Balance, type BalanceProps } from './Balance';
import css from './style.css';
interface Context {
  modelDirectories: { directoryFor(id: string): BalanceProps['directory'] };
  sessions: { subagentAddress(id: string): unknown };
  effect(fn: () => () => void, label?: string): void;
  slots: {
    inject(name: string, fn: () => () => void): void;
    register(options: { name: string; id: string; order: number; inject(id: string): BalanceProps }, component: typeof Balance): () => void;
  };
}
export const name = 'provider-balance';
// directoryFor executes through this caller's context and reads remote.session.
export const inject = ['slots', 'sessions', 'modelDirectories', 'remote', 'remote.session'];
export function apply(ctx: Context) {
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = 'dsh-provider-balance'; style.textContent = css;
    document.head.append(style); return () => style.remove();
  }, 'provider-balance styles');
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    // A list Slot identifies its cell by `id` and orders it by `order`;
    // `priority` only competes for a single Slot's one seat.
    name: 'conversation.input.right', id: 'provider-balance', order: 20,
    inject: sessionId => ({ sessionId, directory: ctx.modelDirectories.directoryFor(sessionId), available: ctx.sessions.subagentAddress(sessionId) === undefined }),
  }, Balance));
}
