import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { NodeSlider, type SliderPartProps } from 'node-slider';
import { activeChoice, effortChoices, selectEffort, selectModel, type Directory, type Selection } from './model';
import { portraitIndex, usePortraits } from './portraits';
const palette = ['#258bd2', '#21bd60', '#e5ad26', '#e87930', '#cc282c'];
function appearance(index: number, count: number, portraits: readonly string[]) {
  const progress = count <= 1 ? 0 : index / (count - 1);
  const imageIndex = portraitIndex(index, count, portraits.length);
  return { color: palette[Math.round(progress * (palette.length - 1))], image: imageIndex === undefined ? undefined : portraits[imageIndex] };
}
function Thumb({ node }: SliderPartProps<{ image: string | undefined }>) {
  const [failed, setFailed] = useState<string>();
  const image = node.data?.image;
  const hasImage = Boolean(image && image !== failed);
  return <span className="mes-thumb" data-image={hasImage ? '' : undefined} aria-hidden="true">{hasImage && <img src={image} alt="" draggable={false} onError={() => setFailed(image)} />}</span>;
}
export interface SelectorProps { directory: Directory; available: boolean; locked: boolean }
export function Selector({ directory, available, locked }: SelectorProps) {
  const state = useSyncExternalStore(fn => directory.store.subscribe(fn), () => directory.store.getSnapshot());
  const { portraits } = usePortraits();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const [position, setPosition] = useState({ left: 0, top: 0, visible: false });
  const model = state.groups.find(g => g.id === state.current?.provider)?.models.find(m => m.id === state.current?.model);
  const choices = useMemo(() => effortChoices(model?.reasoning), [model?.reasoning]);
  const nodes = useMemo(() => choices.map((choice, i) => {
    const look = appearance(i, choices.length, portraits);
    return { ...choice, color: look.color, data: { image: look.image } };
  }), [choices, portraits]);
  const active = activeChoice(state.current, model?.reasoning);
  const shown = nodes.find(n => n.id === preview) ?? nodes.find(n => n.id === active?.id);
  const name = model?.name ?? state.current?.model ?? '选择模型';
  const busy = pending || state.status === 'selecting' || locked;
  const close = () => { setOpen(false); setPreview(null); trigger.current?.focus(); };
  const load = () => { setError(null); void directory.load().catch(e => setError(String(e?.message ?? e))); };
  useEffect(() => { if (available) load(); }, [directory, available]);
  useEffect(() => { setPreview(null); }, [state.current?.provider, state.current?.model, state.current?.reasoningEffort]);
  useEffect(() => { if (locked) setOpen(false); }, [locked]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !panel.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const box = panel.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft ?? 0, topEdge = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
      setPosition({ left: Math.max(leftEdge + 12, Math.min(anchor.left, leftEdge + width - box.width - 12)),
        top: Math.max(topEdge + 12, Math.min(anchor.top - box.height - 10, topEdge + height - box.height - 12)), visible: true });
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(panel.current!);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    panel.current?.focus();
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  async function choose(selection: Selection) {
    if (busy || inFlight.current || !available) { setPreview(null); return; }
    inFlight.current = true; setPending(true); setError(null);
    try { await directory.select(selection); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setPending(false); setPreview(null); }
  }
  if (!available) return null;
  return <>
    <button type="button" ref={trigger} className="mes-trigger" disabled={locked} aria-label={`选择模型，当前 ${name}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { if (open) close(); else { setPreview(null); setPosition(p => ({ ...p, visible: false })); setOpen(true); load(); } }}>
      <span className="mes-trigger-name">{name}</span><span className="mes-trigger-effort" style={{ color: nodes.find(n => n.id === active?.id)?.color }}>{active?.label ?? state.current?.reasoningEffort}</span><span aria-hidden="true">›</span>
    </button>
    {open && createPortal(<div ref={panel} id={id} className="mes-panel" role="dialog" aria-label="模型与推理等级" tabIndex={-1} aria-busy={busy}
      style={{ left: position.left, top: position.top, visibility: position.visible ? 'visible' : 'hidden' }}
      onPointerCancel={() => setPreview(null)}
      onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) setOpen(false); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <div className="mes-heading">
        <div className="mes-level" style={{ color: shown?.color }}>{shown?.label ?? state.current?.reasoningEffort ?? (choices.length ? 'Default' : '模型')}</div>
        <div className="mes-model-name">{name}</div>
        <button type="button" className="mes-reset" aria-label="恢复模型默认推理等级" title="恢复模型默认推理等级" disabled={busy || !state.current || !model?.reasoning}
          onClick={() => { if (state.current) void choose({ provider: state.current.provider, model: state.current.model, ...(model?.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }) }); }}>↻</button>
      </div>
      {nodes.length >= 2 && shown ? <NodeSlider className="mes-slider" nodes={nodes} value={shown.id} disabled={busy} trackHeight={26} endPadding={14} thumbSize={44} showLabels={false} showTooltips duration={260}
        components={{ Thumb }} aria-label="推理等级" onValueChange={setPreview}
        onValueCommit={value => { const choice = choices.find(c => c.id === value); if (state.current && choice) void choose(selectEffort(state.current, choice)); }} />
        : <div className="mes-hint">{nodes.length === 1 ? `推理等级：${nodes[0].label}` : nodes.length > 1 ? '当前等级不在模型目录中，请选择支持的等级' : '此模型未提供推理等级'}</div>}
      {nodes.length >= 2 && !shown && <div className="mes-effort-fallback">{choices.map(c => <button type="button" key={c.id} disabled={busy} onClick={() => state.current && void choose(selectEffort(state.current, c))}>{c.label}</button>)}</div>}
      <div className="mes-list">
        {state.status === 'loading' && <div className="mes-hint" role="status">正在加载模型…</div>}
        {(error || state.error) && <div className="mes-error" role="alert">{error || state.error}<button type="button" onClick={load}>重新加载</button></div>}
        {state.failures.map(f => <div key={f.id} className="mes-error">{f.name}：{f.message}</div>)}
        {state.groups.map(group => <section key={group.id} aria-label={group.name}>
          <div className="mes-group">{group.name}</div>
          {group.models.map(item => { const selected = group.id === state.current?.provider && item.id === state.current?.model;
            return <button type="button" className="mes-option" key={item.id} disabled={busy} aria-pressed={selected} title={item.name}
              onClick={() => { if (!selected) void choose(selectModel(group.id, item, state.current)); }}>
              <span>{item.name}</span><span aria-hidden="true">{selected ? '✓' : ''}</span>
            </button>; })}
        </section>)}
        {state.status === 'ready' && !state.groups.some(g => g.models.length) && <div className="mes-hint">没有可用模型</div>}
      </div>
      <div className="mes-footnote" aria-live="polite">{pending ? '正在应用…' : choices.length >= 2 ? '拖动选择推理等级' : '选择模型'}</div>
    </div>, document.body)}
  </>;
}
