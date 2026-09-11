import './node-slider.js';

const defaults = [
  { label:'休憩', color:'#9DA8B8' },
  { label:'轻松', color:'#78B8A0' },
  { label:'专注', color:'#8674DF' },
  { label:'投入', color:'#DDAB62' },
  { label:'心流', color:'#DB8195' },
];
const slider = document.querySelector('#main-slider');
slider.nodes = defaults;
slider.value = 2;
function update() {
  const node = slider.nodes[slider.value];
  document.querySelector('#number').textContent = String(slider.value + 1).padStart(2,'0');
  document.querySelector('#name').textContent = node.label;
  document.querySelector('#color').textContent = node.color.toUpperCase();
  document.documentElement.style.setProperty('--accent', node.color);
}
slider.addEventListener('change', update);
document.querySelector('#reset').addEventListener('click', () => {
  slider.nodes = defaults;
  slider.value = 2;
  document.querySelectorAll('.swatch input').forEach((input,index) => { input.value = defaults[index].color; });
  update();
});
defaults.forEach((node,index) => {
  const label = document.createElement('label');
  label.className = 'swatch';
  const input = document.createElement('input');
  input.type = 'color'; input.value = node.color; input.setAttribute('aria-label', `${node.label}节点颜色`);
  input.addEventListener('input', () => {
    const nodes = slider.nodes; nodes[index].color = input.value; slider.nodes = nodes; update();
  });
  const text = document.createElement('span'); text.textContent = node.label;
  label.append(input,text); document.querySelector('#swatches').append(label);
});
update();
