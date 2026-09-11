import React from 'react';
import { createRoot } from 'react-dom/client';
import { apply } from '../src/client';
const listeners = new Set<() => void>();
let snapshot = { current: { provider: 'deepseek-official', model: 'test' }, status: 'ready', groups: [], failures: [] };
const directory = { store: { getSnapshot: () => snapshot, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); } }, load: async () => {} };
const disposers: (() => void)[] = [];
const root = createRoot(document.getElementById('root')!);
const ctx = {
  modelDirectories: { directoryFor: () => directory }, sessions: { subagentAddress: () => undefined },
  effect(fn: () => () => void) { disposers.push(fn()); },
  slots: {
    inject(_name: string, fn: () => () => void) { disposers.push(fn()); },
    register(options: { name: string; id?: string; order?: number; inject(id: string): object }, Component: React.ComponentType<any>) {
      if (options.name !== 'conversation.input.right') throw new Error('Wrong slot');
      // A list Slot cell requires an `id`; without it the real runtime drops the registration.
      if (typeof options.id !== 'string' || options.id === '') throw new Error('List Slot registration requires a cell id');
      if (typeof options.order !== 'number') throw new Error('List Slot registration requires an order');
      root.render(<Component {...options.inject('test-session')} />);
      return () => root.unmount();
    },
  },
};
apply(ctx as unknown as Parameters<typeof apply>[0]);
Object.assign(window, {
  balanceTest: {
    select(provider: string) { snapshot = { ...snapshot, current: { provider, model: 'test' } }; for (const fn of listeners) fn(); },
    dispose() { disposers.reverse().forEach(fn => fn()); },
  },
});
