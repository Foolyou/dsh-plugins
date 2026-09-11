import { createRoot } from 'react-dom/client';
import { apply } from '../src/client';
import { useState } from 'react';
import type { DirectoryState, Selection } from '../src/model';
let state: DirectoryState = {
  current: { provider: 'alpha', model: 'four', reasoningEffort: 'high' }, status: 'ready', failures: [], error: null,
  groups: [{ id: 'alpha', name: 'Alpha', models: [
    { id: 'four', name: 'Four levels', reasoning: { defaultEffort: 'high', efforts: ['off','low','high','max'].map(id => ({ id, name: id.toUpperCase() })) } },
    { id: 'single', name: 'Single level', reasoning: { defaultEffort: 'only', efforts: [{ id: 'only', name: 'Only' }] } },
    { id: 'none', name: 'No effort' },
  ] }, { id: 'beta', name: 'Beta', models: [
    { id: 'custom', name: 'Custom provider', reasoning: { efforts: [{ id: 'budget/12', name: '浅思' }, { id: 'budget/98', name: '深思' }] } },
  ] }],
};
const listeners = new Set<() => void>();
const calls: Selection[] = [];
let rejectNext = false;
const directory = { store: { getSnapshot: () => state, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; } },
  load: async () => {}, select: async (selection: Selection) => {
    calls.push(selection); await new Promise(r => setTimeout(r, 30));
    if (rejectNext) { rejectNext = false; throw new Error('Provider rejected effort'); }
    state = { ...state, current: selection }; listeners.forEach(fn => fn());
  } };
Object.assign(window, { fixture: { calls, reject: () => { rejectNext = true; } } });
// Exercise the production registration path, not a separately wired settings mock.
const registrations = new Map<string, { options: any; Component: any }>();
const disposers: (() => void)[] = [];
apply({
  modelDirectories: { directoryFor: () => directory }, sessions: { subagentAddress: () => undefined },
  effect: fn => { disposers.push(fn()); },
  slots: {
    inject: (_name, fn) => { disposers.push(fn()); },
    register: (options: any, Component: any) => { registrations.set(options.name, { options, Component }); return () => { registrations.delete(options.name); }; },
  },
});
const selector = registrations.get('conversation.input.model')!;
const settings = registrations.get('settings.section')!;
function App() {
  const [open, setOpen] = useState(false);
  return <>
    <div style={{ position: 'fixed', inset: '12px 12px auto', maxHeight: '65vh', overflow: 'auto' }}>
      <button onClick={() => setOpen(value => !value)}>{settings.options.label()}</button>
      {open && <settings.Component close={() => setOpen(false)} />}
    </div>
    <selector.Component {...selector.options.inject('fixture')} locked={false} />
  </>;
}
createRoot(document.getElementById('app')!).render(<App />);
window.addEventListener('beforeunload', () => disposers.reverse().forEach(dispose => dispose()));
