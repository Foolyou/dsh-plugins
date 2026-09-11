import { useEffect, useId, useRef, useState } from 'react';
import type { ComponentType, CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';

export interface SliderNode<T = unknown> {
  id: string;
  label: string;
  color: string;
  /** Normalized position, 0–1. Either supply every position or omit all. */
  position?: number;
  data?: T;
}
export interface SliderPartProps<T = unknown> {
  node: SliderNode<T>;
  index: number;
  selected: boolean;
  passed: boolean;
  hovered: boolean;
  dragging: boolean;
  disabled: boolean;
}
export interface SliderChange<T = unknown> {
  node: SliderNode<T>;
  index: number;
  source: 'pointer' | 'keyboard';
}
type Part<T> = ComponentType<SliderPartProps<T>>;
export interface NodeSliderProps<T = unknown> {
  nodes: readonly SliderNode<T>[];
  /** Stable node id. In controlled mode the parent must update this prop. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string, detail: SliderChange<T>) => void;
  /** Fires at pointer release / each keyboard selection. Cancellations do not commit. */
  onValueCommit?: (value: string, detail: SliderChange<T>) => void;
  components?: { Thumb?: Part<T>; Node?: Part<T>; Label?: Part<T>; Tooltip?: Part<T> };
  /** Immediate node-name tooltips on physical node hover and keyboard focus. */
  showTooltips?: boolean;
  renderTooltip?: (props: SliderPartProps<T>) => ReactNode;
  renderThumb?: (props: SliderPartProps<T>) => ReactNode;
  renderNode?: (props: SliderPartProps<T>) => ReactNode;
  renderLabel?: (props: SliderPartProps<T>) => ReactNode;
  trackHeight?: number;
  /** Extra inset from each semicircular cap to the endpoint node center, in px. */
  endPadding?: number;
  thumbSize?: number;
  activationRadius?: number;
  duration?: number;
  easing?: string;
  disabled?: boolean;
  showLabels?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

export function getPositions(nodes: readonly SliderNode[]): number[] {
  if (nodes.length < 2) throw new Error('NodeSlider requires at least two nodes.');
  if (new Set(nodes.map(node => node.id)).size !== nodes.length || nodes.some(node => !node.id)) {
    throw new Error('NodeSlider node ids must be nonempty and unique.');
  }
  const positions = nodes.map((node, index) => node.position ?? index / (nodes.length - 1));
  const explicit = nodes.some(node => node.position !== undefined);
  if ((explicit && nodes.some(node => node.position === undefined)) || positions[0] !== 0 || positions.at(-1) !== 1 ||
    positions.some((position, index) => !Number.isFinite(position) || position < 0 || position > 1 || (index > 0 && position <= positions[index - 1]!))) {
    throw new Error('NodeSlider positions must be strictly increasing from 0 to 1; supply all positions or none.');
  }
  return positions;
}

export function hitTest(x: number, width: number, positions: readonly number[], radius: number): number {
  if (width <= 0) return 0;
  const at = Math.max(0, Math.min(width, x));
  for (let index = 0; index < positions.length; index++) {
    const gap = Math.min(index ? positions[index]! - positions[index - 1]! : Infinity,
      index < positions.length - 1 ? positions[index + 1]! - positions[index]! : Infinity) * width;
    if (Math.abs(at - positions[index]! * width) <= Math.min(radius, gap / 3)) return index;
  }
  for (let index = positions.length - 1; index >= 0; index--) {
    if (at >= positions[index]! * width) return index;
  }
  return 0;
}

function positive(value: number, name: string, allowZero = false) {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${name} is out of range.`);
  return value;
}

/** Presentational React primitive; import node-slider/style.css once in your client entry. */
export function NodeSlider<T = unknown>(props: NodeSliderProps<T>) {
  const { nodes, components, renderThumb, renderNode, renderLabel, renderTooltip, showTooltips = true, disabled = false, showLabels = true,
    trackHeight = 14, endPadding = 6, thumbSize = trackHeight * 2 + 4, activationRadius = 12, duration = 420,
    easing = 'cubic-bezier(.22,.8,.22,1)' } = props;
  const positions = getPositions(nodes);
  positive(trackHeight, 'trackHeight'); positive(thumbSize, 'thumbSize');
  positive(endPadding, 'endPadding', true);
  positive(activationRadius, 'activationRadius', true); positive(duration, 'duration', true);
  const uid = useId();
  const [internal, setInternal] = useState(props.defaultValue ?? nodes[0]!.id);
  // Track identity and physical position, never a potentially stale array index.
  const [hover, setHover] = useState<{ id: string; position: number } | null>(null);
  const hoverIndex = hover ? nodes.findIndex((node, at) => node.id === hover.id && positions[at] === hover.position) : -1;
  const hovered = disabled || hoverIndex < 0 ? null : hoverIndex;
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const control = useRef<HTMLDivElement>(null);
  const clearTooltip = () => { setHover(null); setKeyboardFocus(false); };
  useEffect(() => { if (disabled || hoverIndex < 0) setHover(null); }, [disabled, hoverIndex]);
  useEffect(() => { if (disabled || !showTooltips) setKeyboardFocus(false); }, [disabled, showTooltips]);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ pointer: number; index: number; changed: boolean; offset: number } | null>(null);
  const requested = props.value ?? internal;
  const found = nodes.findIndex(node => node.id === requested);
  if (props.value !== undefined && found < 0) throw new Error(`Unknown NodeSlider value: ${props.value}`);
  // When uncontrolled nodes are removed, display the first remaining node.
  const index = Math.max(0, found);
  const selected = nodes[index]!;
  const tooltipIndex = showTooltips && !disabled ? hovered ?? (keyboardFocus ? index : null) : null;
  const tooltipId = `${uid}-tooltip`;
  useEffect(() => {
    if (tooltipIndex === null) return;
    const document = control.current?.ownerDocument;
    const dismiss = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') clearTooltip(); };
    document?.addEventListener('keydown', dismiss);
    return () => document?.removeEventListener('keydown', dismiss);
  }, [tooltipIndex]);
  const progress = positions[index]!;
  const radius = trackHeight / 2;
  const edgeInset = radius + endPadding;
  // The selected node sits at the center of the rounded end cap, not at
  // its rightmost edge. Keep the first/last stops exactly empty/full.
  const fillAdjust = progress === 0 || progress === 1 ? 0 : edgeInset * (1 - 2 * progress) + radius;
  const variables = {
    '--ns-height': `${trackHeight}px`, '--ns-radius': `${radius}px`, '--ns-thumb-size': `${thumbSize}px`,
    '--ns-edge-inset': `${edgeInset}px`,
    '--ns-hit-height': `${Math.max(44, thumbSize + 8)}px`, '--ns-color': selected.color,
    '--ns-position': `${progress * 100}%`, '--ns-fill-adjust': `${fillAdjust}px`,
    '--ns-duration': `${duration}ms`, '--ns-easing': easing,
    ...props.style,
  } as CSSProperties;
  const state = (at: number): SliderPartProps<T> => ({ node:nodes[at]!, index:at, selected:at === index,
    passed:at < index, hovered:at === hovered, dragging:dragging && !disabled, disabled });
  const content = (kind: 'Thumb' | 'Node' | 'Label' | 'Tooltip', at: number) => {
    const part = state(at);
    const render = kind === 'Thumb' ? renderThumb : kind === 'Node' ? renderNode : kind === 'Tooltip' ? renderTooltip : renderLabel;
    if (render) return render(part);
    const Component = components?.[kind];
    if (Component) return <Component {...part} />;
    return kind === 'Label' || kind === 'Tooltip' ? part.node.label : <span className={`ns-default-${kind.toLowerCase()}`} />;
  };
  const change = (next: number, source: SliderChange<T>['source']) => {
    if (disabled) return;
    const before = gesture.current?.index ?? index;
    if (gesture.current) { gesture.current.index = next; gesture.current.changed ||= next !== before; }
    if (next === before) return;
    if (props.value === undefined) setInternal(nodes[next]!.id);
    props.onValueChange?.(nodes[next]!.id, { node:nodes[next]!, index:next, source });
  };
  const locate = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return hitTest(event.clientX - rect.left - (gesture.current?.offset ?? 0), rect.width, positions, activationRadius);
  };
  const hoverAtPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.pointerType === 'touch') return;
    const rect = event.currentTarget.getBoundingClientRect();
    // Hover is physical proximity, unlike the selection's left-interval rule and grab offset.
    const at = hitTest(event.clientX - rect.left, rect.width, positions, activationRadius);
    const gap = Math.min(at ? positions[at]! - positions[at - 1]! : Infinity,
      at < positions.length - 1 ? positions[at + 1]! - positions[at]! : Infinity) * rect.width;
    const near = rect.width > 0 && Math.abs(event.clientX - rect.left - positions[at]! * rect.width) <= Math.min(activationRadius, gap / 3)
      && Math.abs(event.clientY - rect.top - rect.height / 2) <= Math.max(activationRadius, thumbSize / 2);
    setHover(previous => near
      ? previous?.id === nodes[at]!.id && previous.position === positions[at] ? previous : { id:nodes[at]!.id, position:positions[at]! }
      : null);
    setKeyboardFocus(false);
  };
  const finish = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    clearTooltip();
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    gesture.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (commit && active.changed && !disabled) {
      // Like onValueChange, commit reports intent; controlled value stays authoritative.
      const finalIndex = Math.min(active.index, nodes.length - 1);
      props.onValueCommit?.(nodes[finalIndex]!.id, { node:nodes[finalIndex]!, index:finalIndex, source:'pointer' });
    }
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { clearTooltip(); return; }
    if (disabled) return;
    const keys: Record<string, number> = { ArrowRight:index+1, ArrowUp:index+1, ArrowLeft:index-1, ArrowDown:index-1, Home:0, End:nodes.length-1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    setHover(null); setKeyboardFocus(true);
    const next = Math.max(0, Math.min(nodes.length - 1, keys[event.key]!));
    change(next, 'keyboard');
    if (next !== index) props.onValueCommit?.(nodes[next]!.id, { node:nodes[next]!, index:next, source:'keyboard' });
  };

  return <div id={props.id ?? uid} className={`ns-root ${props.className ?? ''}`} style={variables} data-disabled={disabled || undefined} data-dragging={dragging || undefined}>
    <div ref={control} className="ns-control" role="slider" tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
      aria-label={props['aria-label'] ?? (props['aria-labelledby'] ? undefined : '节点选择')}
      aria-labelledby={props['aria-labelledby']} aria-describedby={[props['aria-describedby'], tooltipIndex !== null ? tooltipId : undefined].filter(Boolean).join(' ') || undefined}
      aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={nodes.length - 1} aria-valuenow={index} aria-valuetext={selected.label}
      onKeyDown={keyboard} onBlur={clearTooltip}
      onFocus={event => { if (event.currentTarget.matches(':focus-visible')) setKeyboardFocus(true); }}
      onPointerEnter={hoverAtPointer}
      onPointerDown={event => {
        if (disabled || gesture.current || event.button !== 0 || !event.isPrimary) return;
        const fromThumb = event.currentTarget.querySelector('.ns-thumb')?.contains(event.target as Node);
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.focus({ preventScroll:true });
        setKeyboardFocus(false);
        event.currentTarget.setPointerCapture(event.pointerId);
        // Preserve the grab point: pressing an icon's edge must not select
        // the preceding interval before the user starts moving it.
        gesture.current = { pointer:event.pointerId, index, changed:false,
          offset:fromThumb ? event.clientX - rect.left - progress * rect.width : 0 };
        setDragging(true);
        if (!fromThumb) change(locate(event), 'pointer');
      }}
      onPointerMove={event => {
        if (disabled || (gesture.current && gesture.current.pointer !== event.pointerId)) return;
        hoverAtPointer(event);
        if (gesture.current) change(locate(event), 'pointer');
      }}
      onPointerLeave={clearTooltip} onPointerUp={event => finish(event, true)}
      onPointerCancel={event => finish(event, false)} onLostPointerCapture={event => finish(event, false)}>
      <div className="ns-rail" aria-hidden="true"><div className="ns-fill" /></div>
      {nodes.map((node, at) => <div key={node.id} className="ns-node" aria-hidden="true"
        data-selected={at === index || undefined} data-passed={at < index || undefined} data-hovered={hovered === at || undefined}
        style={{ left:`${positions[at]! * 100}%` }}>{content('Node', at)}</div>)}
      <div className="ns-thumb" aria-hidden="true">{content('Thumb', index)}</div>
    </div>
    {tooltipIndex !== null && <div className="ns-tooltip-anchor">
      <div id={tooltipId} role="tooltip" className="ns-tooltip" style={{ left:`${positions[tooltipIndex]! * 100}%`,
        transform:`translateX(-${positions[tooltipIndex]! * 100}%)` }}>{content('Tooltip', tooltipIndex)}</div>
    </div>}
    {showLabels && <div className="ns-labels" aria-hidden="true">{nodes.map((node, at) => <div key={node.id}
      className="ns-label" data-selected={at === index || undefined} style={{ left:`${positions[at]! * 100}%` }}>{content('Label', at)}</div>)}</div>}
  </div>;
}
