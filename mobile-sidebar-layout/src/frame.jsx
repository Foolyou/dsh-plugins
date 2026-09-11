// Independent source fork of @deepseek-ai/dsh-client-ui-layout 0.1.5-rc.1.
// MIT © 2026 DeepSeek. Desktop frame, title, slots and drag semantics retained.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useId } from 'react';
import { computeColumns, drawerWidth, SIDEBAR_AUTO_COLLAPSE, MOBILE_BREAKPOINT } from './geometry.js';

function DocumentTitle({ useSessions, usePanelInfo, productTitle }) {
  const showSessionTitle = usePanelInfo(info => info.activePanelId === null);
  const title = useSessions(state => !showSessionTitle || state.current === undefined ? undefined : state.byId[state.current]?.title);
  useEffect(() => {
    document.title = title === undefined ? productTitle : `${title} — ${productTitle}`;
    return () => { document.title = productTitle; };
  }, [productTitle, title]);
  return null;
}
function MainPanel({ usePanelInfo, renderSlot }) {
  return renderSlot('main', {}, { entryKey: usePanelInfo(info => info.activePanelId) ?? 'conversation' });
}
export function DragHandle(props) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef(0), latest = useRef(0), frame = useRef(null), capture = useRef(null);
  const callbacks = useRef(props); callbacks.current = props;
  const endDrag = useCallback(() => {
    const active = capture.current;
    if (active === null) return;
    capture.current = null;
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id);
    setDragging(false); callbacks.current.onEnd();
  }, []);
  useEffect(() => endDrag, [endDrag]);
  const onPointerDown = useCallback(e => {
    if (e.button !== 0 || capture.current !== null) return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    capture.current = { element: e.currentTarget, id: e.pointerId };
    origin.current = latest.current = e.clientX;
    callbacks.current.onStart(); setDragging(true);
  }, []);
  const onPointerMove = useCallback(e => {
    if (capture.current?.id !== e.pointerId) return;
    latest.current = e.clientX;
    frame.current ??= requestAnimationFrame(() => { frame.current = null; callbacks.current.onDrag(latest.current - origin.current); });
  }, []);
  const onPointerUp = useCallback(e => {
    if (capture.current?.id !== e.pointerId) return;
    callbacks.current.onDrag(e.clientX - origin.current); endDrag();
  }, [endDrag]);
  const onPointerCancel = useCallback(e => { if (capture.current?.id === e.pointerId) endDrag(); }, [endDrag]);
  return <div className="msl-handle" style={{ left: props.left }} data-side={props.side} data-dragging={dragging || undefined}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
    onPointerCancel={onPointerCancel} onLostPointerCapture={onPointerCancel} />;
}
const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
function focusables(el) {
  return [...el.querySelectorAll(focusableSelector)].filter(node => !node.closest('[inert]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
}
/** Trap only this drawer's keyboard scope, never a native shell/portal overlay above it. */
function useDrawerFocus(open, drawerRef, triggerRef, close) {
  useLayoutEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    const previous = document.activeElement;
    const activeModal = drawer.querySelector('[role="dialog"][aria-modal="true"]:not([hidden])');
    (focusables(activeModal ?? drawer)[0] ?? activeModal ?? drawer).focus({ preventScroll: true });
    const onKeyDown = event => {
      if (event.defaultPrevented) return;
      // Native settings is a fixed descendant dialog, not necessarily a portal.
      // Its Escape handler need not preventDefault; never close both modal layers.
      const modal = event.target.closest?.('[role="dialog"][aria-modal="true"]');
      if (modal && modal !== drawer) return;
      // Settings/dialogs can portal to body or shell.overlay. Their own focus and Escape win.
      if (!drawer.contains(event.target) && event.target !== document.body) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables(drawer);
      if (!items.length) { event.preventDefault(); drawer.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === drawer)) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Do not steal focus from a higher overlay opened from this drawer.
      if (drawer.contains(document.activeElement) || document.activeElement === document.body) {
        const target = triggerRef.current ?? previous;
        if (target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
      }
    };
  }, [open, drawerRef, triggerRef, close]);
}
export function AppFrame({ useStore, useSessions, usePanelInfo, actions, renderSlot, t }) {
  const layoutInfo = useStore(state => state.layoutInfo);
  const frameRef = useRef(null), drawerRef = useRef(null), triggerRef = useRef(null);
  const drawerId = useId();
  const viewport = layoutInfo.viewportWidth;
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (el === null) return;
    let raf = null, disposed = false;
    const measure = () => { const width = el.getBoundingClientRect().width; if (width > 0) actions.setViewportWidth(width); };
    measure();
    const observer = new ResizeObserver(() => {
      if (disposed) return;
      raf ??= requestAnimationFrame(() => { raf = null; measure(); });
    });
    observer.observe(el);
    return () => { disposed = true; observer.disconnect(); if (raf !== null) cancelAnimationFrame(raf); };
  }, [actions]);
  const mobile = viewport < MOBILE_BREAKPOINT;
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE;
  const sidebarCollapsed = narrow ? !layoutInfo.narrowExpanded : layoutInfo.sidebar === 0;
  const sidebarPreference = sidebarCollapsed ? 0 : layoutInfo.sidebar === 0 ? 280 : layoutInfo.sidebar;
  const rightbarPreference = layoutInfo.rightbar ?? viewport * 0.45;
  const normal = computeColumns(viewport, !layoutInfo.rightbarShown && narrow ? 0 : sidebarPreference, rightbarPreference);
  const cols = computeColumns(viewport, sidebarPreference, layoutInfo.rightbarTrack ? rightbarPreference : 0);
  const colsRef = useRef(cols); colsRef.current = cols;
  const rightbarWidth = useRef(normal.rightbar); rightbarWidth.current = normal.rightbar;
  const sidebarBase = useRef(0), rightbarBase = useRef(0);
  const [dragging, setDragging] = useState(false);
  const onDragEnd = useCallback(() => setDragging(false), []);
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true); }, []);
  const onSidebarDrag = useCallback(dx => actions.setSidebar(sidebarBase.current + dx), [actions]);
  const onRightbarStart = useCallback(() => { rightbarBase.current = rightbarWidth.current; setDragging(true); }, []);
  const onRightbarDrag = useCallback(dx => actions.setRightbar(rightbarBase.current - dx), [actions]);
  const open = mobile && !sidebarCollapsed;
  const close = useCallback(() => actions.toggleSidebar(), [actions]);
  useDrawerFocus(open, drawerRef, triggerRef, close);
  useLayoutEffect(() => {
    if (!mobile || open) return;
    // Native startup/settings dialogs can be descendants of the still-mounted sidebar.
    // Reveal their owning drawer instead of leaving an active modal under inert.
    const drawer = drawerRef.current;
    let requested = false;
    const revealModal = () => {
      if (requested) return;
      const modal = drawer.querySelector('[role="dialog"][aria-modal="true"]:not([hidden])');
      if (modal) { requested = true; actions.toggleSidebar(); }
    };
    const observer = new MutationObserver(revealModal);
    observer.observe(drawer, { childList: true, subtree: true });
    revealModal();
    return () => observer.disconnect();
  }, [mobile, open, actions]);
  // Mobile uses the expanded native sidebar even while hidden: preserve workspaces, drafts and scroll.
  const slotCollapsed = mobile ? false : sidebarCollapsed;
  const slotWidth = mobile ? drawerWidth(viewport, layoutInfo.sidebar) : cols.sidebar;
  const sidebar = useMemo(() => renderSlot('sidebar', { collapsed: slotCollapsed, width: slotWidth }), [renderSlot, slotCollapsed, slotWidth]);
  const main = useMemo(() => <MainPanel usePanelInfo={usePanelInfo} renderSlot={renderSlot} />, [usePanelInfo, renderSlot]);
  const overlays = useMemo(() => renderSlot('shell.overlay', {}), [renderSlot]);
  return <div ref={frameRef} className="msl-frame"
    style={{ gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.rightbar}px`, '--msl-drawer-width': `${slotWidth}px` }}
    data-mobile={mobile || undefined} data-drawer-open={open || undefined}
    data-sidebar-collapsed={sidebarCollapsed || undefined} data-rightbar-collapsed={cols.rightbar === 0 || undefined}
    data-rightbar-fullscreen={layoutInfo.rightbarFullscreen || undefined} data-rightbar-instant={layoutInfo.rightbarInstant || undefined}
    data-dragging={dragging || undefined}>
    <DocumentTitle productTitle="DeepSeek Harness" useSessions={useSessions} usePanelInfo={usePanelInfo} />
    <div ref={drawerRef} id={drawerId} className="msl-sidebar" role={mobile ? 'dialog' : undefined}
      aria-label={mobile ? 'Navigation' : undefined} aria-modal={open ? true : undefined}
      aria-hidden={mobile && !open ? true : undefined} inert={mobile && !open ? '' : undefined} tabIndex={mobile ? -1 : undefined}>
      {sidebar}
    </div>
    <div className="msl-center" inert={open ? '' : undefined}>{main}</div>
    <div className="msl-rightbar" data-rightbar-col={true} inert={open ? '' : undefined}>
      {renderSlot('rightbar', { width: normal.rightbar, viewportWidth: viewport, canShow: normal.rightbar > 0 })}
    </div>
    <div className="msl-overlay" data-shell-overlay={true}>{overlays}</div>
    {mobile && <>
      {open && <div className="msl-backdrop" data-mobile-backdrop={true} aria-hidden="true" onClick={close} />}
      <button ref={triggerRef} className="msl-trigger" type="button" aria-label="Open sidebar" hidden={open}
        aria-controls={drawerId} aria-expanded={open} aria-haspopup="dialog" title="展开侧栏" onClick={close}>
        <svg width="16" height="20" viewBox="0 0 16 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 5 5 5-5 5"/>
        </svg>
      </button>
    </>}
    {!mobile && !sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
    {!mobile && layoutInfo.rightbarShown && !layoutInfo.rightbarFullscreen && normal.rightbar > 0 &&
      <DragHandle side="rightbar" left={viewport - normal.rightbar} onStart={onRightbarStart} onDrag={onRightbarDrag} onEnd={onDragEnd} />}
  </div>;
}
