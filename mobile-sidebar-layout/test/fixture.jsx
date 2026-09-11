import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { AppFrame } from '../src/frame.jsx';
import { layoutSpec } from '../src/store.js';
import { ThemePresenter } from '../src/theme.js';
import css from '../src/style.css';
const style = document.createElement('style'); style.textContent = css; document.head.append(style);
const spec = layoutSpec(window.innerWidth);
let state = spec.init();
const listeners = new Set();
const actions = Object.fromEntries(Object.entries(spec.actions).map(([key, reducer]) => [key, (...args) => {
  state = structuredClone(state); reducer(state, ...args); for (const listener of listeners) listener();
}]));
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const useStore = selector => selector(useSyncExternalStore(subscribe, () => state));
const usePanelInfo = selector => useStore(s => selector(s.panelInfo));
const useSessions = selector => selector({ current: 'one', byId: { one: { title: 'Fixture session' } } });
let showOverlay = () => {};
window.mounts = 0;
function Sidebar({ collapsed, width }) {
  const [draft, setDraft] = useState('');
  useEffect(() => { window.mounts++; return () => window.mounts--; }, []);
  return <nav data-native-sidebar="" data-collapsed={collapsed} data-width={width} style={{height:'100%', display:'flex', flexDirection:'column', padding:12, boxSizing:'border-box'}}>
    <button onClick={actions.toggleSidebar}>Native collapse</button>
    {!collapsed && <><input aria-label="Sidebar draft" value={draft} onChange={e => setDraft(e.target.value)}/><div style={{flex:1,overflow:'auto'}}>Workspaces and sessions</div></>}
    <button onClick={() => showOverlay(true)}>Settings</button>
    <Overlay />
  </nav>;
}
function Overlay() {
  const [open, setOpen] = useState(false); showOverlay = setOpen;
  const close = () => { setOpen(false); document.querySelector('[data-native-sidebar] > button:last-of-type').focus(); };
  useEffect(() => {
    if (!open) return;
    document.querySelector('[data-settings] button').focus();
    // Match native settings' document listener: deliberately no preventDefault.
    const key = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open]);
  const panel = open ? <div role="dialog" aria-modal="true" aria-label="Settings" data-settings=""
    style={{position:'fixed',inset:30,zIndex:1000,background:'white'}} onKeyDown={e => {
      if (e.key === 'Tab') { e.preventDefault(); e.currentTarget.querySelector('button').focus(); }
    }}><button onClick={close}>Close settings</button></div> : null;
  return new URLSearchParams(location.search).has('portal') ? createPortal(panel, document.body) : panel;
}
function renderSlot(name, props, options) {
  if (name === 'sidebar') return <Sidebar {...props}/>;
  if (name === 'main') return <main style={{flex:1}}><button style={{margin:0}}>Main action</button><p>{options.entryKey}</p></main>;
  if (name === 'rightbar') return <div data-panel="" data-width={props.width} data-can-show={props.canShow}/>;
  if (name === 'shell.overlay') return null;
}
const root = createRoot(document.getElementById('root'));
root.render(<AppFrame {...{useStore,useSessions,usePanelInfo,actions,renderSlot,t:s=>s}}/>);
window.fixture = { actions, showSettings: () => showOverlay(true), getState: () => state, unmount: () => root.unmount(), theme: new ThemePresenter() };
