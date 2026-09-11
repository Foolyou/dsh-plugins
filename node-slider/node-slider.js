import { nodeAtPosition } from './slider-math.js';

export class NodeSlider extends HTMLElement {
  #nodes = [];
  #value = 0;
  #dragging = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display:block; --slider-background:#e9e7ee; --slider-duration:420ms; --slider-color:#8674df; }
        * { box-sizing:border-box; }
        .control { position:relative; height:44px; outline:none; touch-action:pan-y; cursor:pointer; }
        .rail { position:absolute; top:15px; height:14px; left:-7px; right:-7px; border-radius:7px; background:var(--slider-background); }
        .fill { position:absolute; inset:0 auto 0 0; width:calc(var(--position,0%) + var(--fill-adjust,0px)); border-radius:inherit; background:var(--slider-color); transition:width var(--slider-duration) cubic-bezier(.22,.8,.22,1), background-color var(--slider-duration) ease; }
        .node { position:absolute; top:0; width:24px; height:44px; transform:translateX(-50%); display:grid; place-items:center; }
        .node::after { content:''; width:4px; height:4px; border-radius:50%; background:#716a85; opacity:.38; transition:transform 180ms ease,opacity 180ms ease; }
        .node.passed::after { background:white; opacity:.65; }
        .node:hover::after,.node.active::after { transform:scale(1.8); opacity:.9; }
        .thumb { pointer-events:none; position:absolute; top:6px; left:var(--position,0%); width:32px; height:32px; transform:translateX(-50%); border-radius:50%; background:var(--slider-color); box-shadow:0 0 0 4px #fff,0 3px 8px #29203a22; transition:left var(--slider-duration) cubic-bezier(.22,.8,.22,1),background-color var(--slider-duration) ease,box-shadow 180ms ease; }
        .control:focus-visible .thumb { box-shadow:0 0 0 4px #fff,0 0 0 7px var(--slider-color); }
        .labels { position:relative; height:36px; margin-top:9px; font:inherit; font-size:12px; color:#96929e; }
        .label { position:absolute; transform:translateX(-50%); white-space:nowrap; transition:color var(--slider-duration) ease; }
        .label.selected { color:var(--slider-color); font-weight:600; }
        @media(prefers-reduced-motion:reduce) { *,*::after { transition:none!important; } }
      </style>
      <div class="control" role="slider" tabindex="0" aria-valuemin="0">
        <div class="rail"><div class="fill"></div></div>
        <div class="nodes"></div><div class="thumb"></div>
      </div><div class="labels" aria-hidden="true"></div>`;
    const control = this.shadowRoot.querySelector('.control');
    const selectAt = event => {
      const rect = control.getBoundingClientRect();
      this.select(nodeAtPosition(event.clientX - rect.left, rect.width, this.#nodes.length), true);
    };
    control.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      this.#dragging = true;
      control.focus({ preventScroll:true });
      control.setPointerCapture(event.pointerId);
      selectAt(event);
    });
    control.addEventListener('pointermove', event => {
      const rect = control.getBoundingClientRect();
      const step = rect.width / (this.#nodes.length - 1);
      this.shadowRoot.querySelectorAll('.node').forEach((node, index) => {
        node.classList.toggle('active', Math.abs(event.clientX - rect.left - index * step) <= Math.min(12, step / 3));
      });
      if (this.#dragging) selectAt(event);
    });
    const finish = () => { this.#dragging = false; this.shadowRoot.querySelectorAll('.active').forEach(node => node.classList.remove('active')); };
    control.addEventListener('pointerup', finish);
    control.addEventListener('pointercancel', finish);
    control.addEventListener('lostpointercapture', finish);
    control.addEventListener('pointerleave', () => { if (!this.#dragging) finish(); });
    control.addEventListener('keydown', event => {
      const values = { ArrowRight:this.#value+1, ArrowUp:this.#value+1, ArrowLeft:this.#value-1, ArrowDown:this.#value-1, Home:0, End:this.#nodes.length-1 };
      if (!(event.key in values)) return;
      event.preventDefault();
      this.select(values[event.key], true);
    });
  }

  connectedCallback() {
    this.shadowRoot.querySelector('.control').setAttribute('aria-label', this.getAttribute('aria-label') || '节点选择');
  }

  set nodes(nodes) {
    if (!Array.isArray(nodes) || nodes.length < 2 || nodes.some(node => !node || typeof node.label !== 'string' || !CSS.supports('color', node.color))) {
      throw new TypeError('nodes requires at least two { label, color } entries with valid CSS colors.');
    }
    this.#nodes = nodes.map(node => ({ ...node }));
    this.#value = Math.min(this.#value, nodes.length - 1);
    const dots = this.shadowRoot.querySelector('.nodes');
    const labels = this.shadowRoot.querySelector('.labels');
    dots.replaceChildren(); labels.replaceChildren();
    nodes.forEach((node, index) => {
      const dot = document.createElement('span');
      dot.className = 'node'; dot.style.left = `${index / (nodes.length - 1) * 100}%`;
      dot.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'label'; label.style.left = dot.style.left; label.textContent = node.label;
      dots.append(dot); labels.append(label);
    });
    this.#render();
  }
  get nodes() { return this.#nodes.map(node => ({ ...node })); }
  set value(value) { this.select(value); }
  get value() { return this.#value; }

  select(value, notify = false) {
    if (!this.#nodes.length || !Number.isFinite(Number(value))) return;
    const next = Math.max(0, Math.min(this.#nodes.length - 1, Math.round(Number(value))));
    if (next === this.#value) return;
    this.#value = next;
    this.#render();
    if (notify) this.dispatchEvent(new CustomEvent('change', { bubbles:true, composed:true, detail:{ value:next, node:{ ...this.#nodes[next] } } }));
  }

  #render() {
    const node = this.#nodes[this.#value];
    if (!node) return;
    const progress = this.#value / (this.#nodes.length - 1);
    this.style.setProperty('--position', `${progress * 100}%`);
    // The rail extends 7px beyond each endpoint. Align intermediate fill edges
    // with node centers, while keeping the endpoint states fully empty/full.
    this.style.setProperty('--fill-adjust', `${progress === 0 || progress === 1 ? 0 : 7 - 14 * progress}px`);
    this.style.setProperty('--slider-color', node.color);
    const control = this.shadowRoot.querySelector('.control');
    control.setAttribute('aria-valuemax', this.#nodes.length - 1);
    control.setAttribute('aria-valuenow', this.#value);
    control.setAttribute('aria-valuetext', node.label);
    this.shadowRoot.querySelectorAll('.node').forEach((dot, index) => dot.classList.toggle('passed', index < this.#value));
    this.shadowRoot.querySelectorAll('.label').forEach((label, index) => label.classList.toggle('selected', index === this.#value));
  }
}
customElements.define('node-slider', NodeSlider);
