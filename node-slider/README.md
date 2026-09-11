# Node Slider · React / DeepSeek Harness

可用于 DeepSeek Harness Web UI 插件的 TypeScript React 展示组件。使用 React 18/19，React 作为 peer dependency，不内置第二份 React，不依赖 Cordis、全局状态或浏览器自定义元素注册。

## 本地预览与交付

```bash
npm install
npm run build
npm start
```

- React 可定制演示：http://localhost:15081/react.html
- 原版 Web Component 演示：http://localhost:15081/
- `npm run typecheck`：组件类型检查。
- `npm test`：原版区间选择测试。
- `npm run test:browser`：React 浏览器交互测试；默认使用本机 WSL Chrome，可通过 `CHROME_PATH` 指定其他 Chrome 路径。
- `npm pack`：生成 `node-slider-0.1.0.tgz`，在目标插件目录执行 `npm install /absolute/path/node-slider-0.1.0.tgz`。

包导出 `node-slider`（ESM + 类型声明）和 `node-slider/style.css`。`dist/` 是组件库，`demo-dist/` 是仅用于预览的独立演示包。打包不发布到 npm，也不自动安装或修改现有 Harness 插件。

## 基本用法

```tsx
import { useState } from 'react';
import { NodeSlider } from 'node-slider';
import type { SliderNode } from 'node-slider';
import 'node-slider/style.css';

const nodes: SliderNode[] = [
  { id: 'low', label: '轻量', color: '#78B8A0' },
  { id: 'medium', label: '标准', color: '#8674DF' },
  { id: 'high', label: '深入', color: '#DB8195' },
];

export function LevelControl() {
  const [value, setValue] = useState('medium');
  return <NodeSlider nodes={nodes} value={value} onValueChange={setValue}
    aria-label="处理档位" />;
}
```

`value` / `defaultValue` 使用稳定节点 **id**，不是数组索引。受控模式下父组件须更新 `value`，适合绑定 Harness 提供的状态与操作回调。省略 `value` 时使用内部状态，`defaultValue` 只决定初始值。不要在同一实例生命周期中切换受控/非受控模式。

## 自定义控制头、节点和标签

```tsx
import type { SliderPartProps } from 'node-slider';

function MyThumb({ node, dragging }: SliderPartProps) {
  return <span style={{
    width: '100%', height: '100%', display: 'grid', placeItems: 'center',
    borderRadius: 8, background: 'currentColor', opacity: dragging ? 0.85 : 1,
  }}><span style={{ color: 'white' }}>{node.label.slice(0, 1)}</span></span>;
}

function MyNode({ hovered, passed }: SliderPartProps) {
  return <span style={{
    width: 6, height: 6, background: passed ? 'white' : '#777',
    transform: `rotate(45deg) scale(${hovered ? 1.5 : 1})`,
    transition: 'transform 180ms ease',
  }} />;
}

<NodeSlider nodes={nodes} defaultValue="medium"
  components={{ Thumb: MyThumb, Node: MyNode }}
  renderLabel={({ node, selected }) => <span style={{ opacity: selected ? 1 : 0.6 }}>{node.label}</span>}
/>;
```

- `components.Thumb / Node / Label / Tooltip` 接收 React 组件类型，组件可使用 Hooks；请在组件外定义类型以保持身份稳定。
- `renderThumb / renderNode / renderLabel / renderTooltip` 接收渲染函数，优先于对应 `components`，返回 `null` 可隐藏内容；不要在渲染回调里直接调用 Hooks。
- 所有渲染入口接收 `node, index, selected, passed, hovered, dragging, disabled`。`node.data` 支持泛型，方便携带图标或业务元数据。
- Slider 拥有定位、填充、手势和键盘行为，调用方替换外观。渲染内容应是非交互展示元素，不放按钮、链接或可聚焦控件；整个 Slider 只有一个键盘焦点。
- 控制头容器的 `currentColor` 同步渐变到目标节点颜色；自定义外观使用 `currentColor` 可直接跟随。直接读取 `node.color` 会得到目标色，若使用它设置背景，请自行加颜色过渡。
- 默认节点自带 hover 放大；自定义节点通过 `hovered` 自行定义效果。

## 配置

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `nodes` | 必填 | 至少两个 `{ id, label, color, position?, data? }`；id 非空且唯一，color 使用有效 CSS 颜色 |
| `value / defaultValue` | 首节点 | 受控 / 非受控节点 id |
| `onValueChange(id, detail)` | — | 用户切换节点时触发，拖动中也触发 |
| `onValueCommit(id, detail)` | — | 指针抬起时提交最后一次用户选择；键盘每次有效切换即提交 |
| `components / render*` | 默认外观 | 控制头、节点、标签扩展入口 |
| `trackHeight` | `14` | 轨道高度 px；圆角半径自动为高度一半 |
| `endPadding` | `6` | 首尾节点额外内缩留白 px；节点中心到轨道边缘的距离为 `trackHeight / 2 + endPadding`，自定义大图标可增大此值 |
| `thumbSize` | `trackHeight * 2 + 4` | 控制头容器边长 px |
| `activationRadius` | `12` | 节点激活半径 px，实际不超过相邻最短间距的三分之一 |
| `duration / easing` | `420` / `cubic-bezier(.22,.8,.22,1)` | 位移与色彩共用的动画时长 ms 和 CSS 缓动 |
| `disabled / showLabels` | `false` / `true` | 禁用交互 / 显示标签 |
| `showTooltips` | `true` | 立即显示节点名称提示；与 showLabels 独立 |
| `renderTooltip / components.Tooltip` | `node.label` | 替换提示内容，不改变命中、定位和生命周期 |
| `className / style / id` | — | 根容器配置 |
| `aria-label / aria-labelledby / aria-describedby` | `节点选择` / — / — | 无障碍名称与描述 |

`detail` 包含 `{ node, index, source: 'pointer' | 'keyboard' }`。两个回调都表示用户意图；受控模式最终显示始终以父级 `value` 为准。`onValueCommit` 不保证父级已接受该值。无变化不提交，指针取消不提交；取消前已发生的 `onValueChange` 不回滚。外部 prop 更新不触发回调。

节点默认等距；使用 `position` 时必须给全部节点指定 0–1 的严格递增位置，首尾分别为 0 和 1。点击区间归左节点，进入节点激活区优先选中该节点。首节点整轨空，末节点整轨满。原版“加厚轨道 + 外延半圆端帽”的几何关系保留。

无效节点数量、重复 id、无效位置、未知受控值及非法尺寸会抛出明确错误。非受控模式删除当前节点时回退到首节点。节点数据及 CSS 颜色应由调用方保证有效。

鼠标靠近实际节点时立即显示自定义 DOM tooltip（无原生 `title` 延迟），悬停不会改变选择或触发回调。键盘焦点显示当前节点名称；离开、失焦、Escape、指针取消或禁用时关闭。提示使用 `role="tooltip"` 并追加至调用方 `aria-describedby`，不拦截指针。长名称自动换行并限制在轨道宽度内；提示位于轨道上方，宿主应保留顶部空间并避免祖先 `overflow: hidden` 裁切。自定义标签不会影响默认提示的 `node.label`。

## 样式与主题

样式限定在 `.ns-*` 命名空间内，不修改 body、字体或宿主全局主题。组件默认继承宿主字体。主题可用 CSS 变量覆盖：

```css
.my-harness-slider {
  --ns-background: #383441;
  --ns-surface: #24212b;
  --ns-muted: #aaa3b5;
  --ns-dot-color: #bbb3c9;
  --ns-dot-passed: #fff;
  --ns-hover-scale: 1.8;
  --ns-tooltip-background: #292433;
  --ns-tooltip-color: #fff;
  --ns-tooltip-border: transparent;
}
```

传 `className="my-harness-slider"` 即可。`--ns-surface` 应设置为所在面板背景色。`.ns-rail / .ns-fill / .ns-thumb / .ns-node / .ns-label` 可用于局部样式；尺寸优先使用 props 以保持轨道与控制头几何关系。外部 CSS 若覆盖定位、宽高或 transition，应自行保持一致。

默认样式支持 `prefers-reduced-motion`。自定义组件的动态效果也应尊重此偏好。支持鼠标、触控、方向键、Home / End，触控时仍允许纵向滚动。

## DeepSeek Harness 接入

参考当前官方 [Web Client architecture](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/web-client) 和 [Web Client Slots](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/slots)：

1. 将组件库安装为现有 Web UI 插件的展示依赖，在插件浏览器 `/client` 入口导入组件和 CSS；不要在 Host 入口挂载 React。
2. 在插件自己的展示组件里使用 Slider。组件 props 接收值及操作回调，不接收 Cordis `ctx`。
3. `examples/harness-client.tsx` 演示通过 `ctx.slots.inject()` 等待 `conversation.session.header.actions`，再用独立 id 注册。该示例使用局部演示状态，运行会话期间禁用，不会改变模型设置或任何 Harness 业务配置。
4. 接入真实业务时，由插件的 `apply` / registration inject 提供状态和命令回调，将用户选择交给已有服务处理。不要在 Slider 内自行复制或持久化 Harness 状态。
5. 本库是通用展示原语；插件内部可使用 `components` / `render*` 组合。若希望**其他独立 Harness 插件**替换你的控制头或节点，应由拥有展示位置的插件声明 typed child Slots，并通过 `renderThumb` / `renderNode` 调用其授权的 `renderSlot`，而不是跨插件传递 React 组件或通过 service inject 传 ReactNode。

示例采用官方当前的 Slots 注册方式，供复制到已有插件的 Client 构建中使用；本仓库未启动完整 Harness 实例做加载联调。最终插件仍须按目标 Harness 版本的 Client 模块打包/加载规范构建，复用宿主 React。

## 原版 Web Component

原版 `node-slider.js`、`slider-math.js` 和 `index.html` 保留可运行演示；npm 组件包导出的是新的 React 实现。原版仍可通过 `slider.nodes = [{ label, color }, ...]`、数字索引 `slider.value` 和 `change` 事件使用。
