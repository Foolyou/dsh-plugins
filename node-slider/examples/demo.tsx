import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NodeSlider } from '../src/index';
import type { SliderNode, SliderPartProps } from '../src/index';
import '../src/node-slider.css';

const nodes: SliderNode<{ icon: string }>[] = [
  { id:'rest', label:'休憩', color:'#9DA8B8', data:{ icon:'☾' } },
  { id:'easy', label:'轻松', color:'#78B8A0', data:{ icon:'❋' } },
  { id:'focus', label:'专注', color:'#8674DF', data:{ icon:'✳' } },
  { id:'deep', label:'投入', color:'#DDAB62', data:{ icon:'✦' } },
  { id:'flow', label:'心流', color:'#DB8195', data:{ icon:'∞' } },
];
function ThumbIcon({ icon }: { icon?: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {icon === '☾' ? <path d="M17.5 18.5A8 8 0 0 1 7.5 6.5a7.5 7.5 0 0 0 10 12Z" />
      : icon === '∞' ? <path d="M12 12C9 6 3 6 3 12s6 6 9 0 9-6 9 0-6 6-9 0Z" />
      : icon === '✦' ? <path d="M12 3Q14 10 21 12Q14 14 12 21Q10 14 3 12Q10 10 12 3Z" fill="currentColor" stroke="none" />
      : <><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />{icon === '❋' && <circle cx="12" cy="12" r="5" />}</>}
  </svg>;
}
function IconThumb({ node }: SliderPartProps<{ icon: string }>) {
  return <span className="custom-thumb" data-icon={node.data?.icon}><ThumbIcon icon={node.data?.icon} /></span>;
}
function DiamondNode({ hovered, passed }: SliderPartProps<{ icon: string }>) {
  return <span className="diamond-node" style={{ transform:`rotate(45deg) scale(${hovered ? 1.6 : 1})`, background:passed ? 'white' : '#7f768f' }} />;
}
function Demo() {
  const [value, setValue] = useState('focus');
  const [commit, setCommit] = useState('尚未提交');
  const [custom, setCustom] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [uneven, setUneven] = useState(false);
  const [tooltips, setTooltips] = useState(true);
  const [tooltipCustom, setTooltipCustom] = useState(false);
  const [shortNodes, setShortNodes] = useState(false);
  const [longLabel, setLongLabel] = useState(false);
  return <main><div className="eyebrow">REACT COMPONENT / HARNESS READY</div><h1>由你定义，<br /><span>每一个细节。</span></h1>
    <p className="intro">可替换控制头与节点 · 受控状态 · 独立样式</p>
    <section className="playground" style={{ padding:32 }}><h2>组件插槽</h2>
      <div style={{ display:'flex', gap:20, margin:'20px 0 30px', fontSize:12 }}>
        <label><input type="checkbox" checked={custom} onChange={event => setCustom(event.target.checked)} /> 自定义组件</label>
        <label><input type="checkbox" checked={disabled} onChange={event => setDisabled(event.target.checked)} /> 禁用</label>
      </div>
      <NodeSlider nodes={nodes} value={value} onValueChange={setValue} disabled={disabled} aria-label="节奏"
        onValueCommit={next => setCommit(next)} components={custom ? { Thumb:IconThumb, Node:DiamondNode } : undefined} />
      <p style={{ fontSize:12, color:'#96929e' }}>当前值：<output data-testid="value">{value}</output> · 最后提交：<output data-testid="commit">{commit}</output></p>
    </section>
    <section className="playground" style={{ padding:32, marginTop:24 }}><h2>等距节点 · 紧凑尺寸</h2><p className="intro">节点默认均匀分布，也可以开启非等距布局查看效果。</p>
      <label style={{ display:'block', fontSize:12, marginBottom:24 }}><input type="checkbox" checked={uneven} onChange={event => setUneven(event.target.checked)} /> 非等距布局</label>
      <NodeSlider nodes={uneven ? nodes.map((node, index) => ({ ...node, position:[0,.15,.4,.7,1][index]! })) : nodes}
        defaultValue="easy" trackHeight={10} thumbSize={24} duration={300} aria-label="紧凑节奏"
        renderThumb={({ node }) => <span className="custom-thumb" style={{ borderRadius:8 }}><ThumbIcon icon={node.data?.icon} /></span>} />
    </section>
    <section className="playground" style={{ padding:32, marginTop:24 }}><h2>Tooltip regression fixture</h2>
      <label><input type="checkbox" checked={tooltips} onChange={event => setTooltips(event.target.checked)} /> Tooltips</label>
      <label><input type="checkbox" checked={tooltipCustom} onChange={event => setTooltipCustom(event.target.checked)} /> Custom tooltip</label>
      <label><input type="checkbox" checked={shortNodes} onChange={event => setShortNodes(event.target.checked)} /> Fewer nodes</label>
      <label><input type="checkbox" checked={longLabel} onChange={event => setLongLabel(event.target.checked)} /> Long label</label>
      <p id="tooltip-help">Caller description</p>
      <NodeSlider aria-label="Tooltip fixture" aria-describedby="tooltip-help" showLabels={false} showTooltips={tooltips}
        nodes={(shortNodes ? nodes.slice(0, 2) : nodes).map(node => ({ ...node, label:longLabel ? node.label + ' long-name'.repeat(40) : node.label }))}
        renderLabel={() => 'Not the node name'}
        renderTooltip={tooltipCustom ? ({ node }) => <strong>Custom: {node.label}</strong> : undefined} />
    </section><footer><a href="/">原版演示 ↗</a><span>React + TypeScript / 无 Harness 运行时耦合</span></footer>
  </main>;
}
createRoot(document.querySelector('#root')!).render(<Demo />);
