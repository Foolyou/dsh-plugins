# Model Effort Slider · DeepSeek Harness

以本仓库 `node-slider` React 组件替换 composer 的模型选择器：档位标题、渐变色轨道和供应商分组模型列表。未提供图片或图片加载失败时只显示轨道和节点，不显示图片框或倒三角，并收起上方图片预留空间及隐藏的图片拖拽区域；仍可直接拖动轨道或用键盘操作。上传图片后按图片控制头尺寸自动展开预留空间，仅显示图片框，不附带倒三角。删除全部图片或加载失败时会立即恢复紧凑布局。插件不附带图片，不从外部网站加载图片，也不在构建产物中内嵌图片。

## 自选图片

打开 DSH **设置 → 推理滑块图片**：

- 手动选择最多六张任意内容的栅格图片，支持 PNG、JPEG 或 WebP（不支持 SVG / GIF）；每张必须大于 0 且不超过 **2 MiB**，解码后宽高均不超过 **4096 像素**。
- 校验文件类型、文件头与实际浏览器解码结果，居中裁剪为 **160 × 160** PNG 静态图片。预览、前移/后移、移除或「重置为纯色滑块」均在此页面操作；支持键盘、输入标签与状态/错误播报。多文件按浏览器文件列表顺序追加，可用前移/后移明确排序。任一文件失败则整批不保存。
- 图片按顺序从最低到最高推理等级均匀映射；一张用于所有等级，零张恢复纯色。节点比图片少时只取分布位置的图片，不影响真实 effort 值。
- 只保存到当前浏览器、当前站点的 `localStorage` 键 `dsh.model-effort-slider.portraits.v1`。**不上传服务器、不写入仓库、不随账号或设备同步**。存储为版本化的归一化 PNG 数据，每张上限 160 KiB 字符，最多六张。原文件与文件名不保存；清除站点数据会删除偏好。与其他浏览器本地数据一样，同源脚本可以读取它，请勿上传敏感图片。
- 同页选择器即时更新；同源其他标签页通过 storage 事件同步；刷新后重新校验和解码本地数据。损坏数据退回纯色并在设置中显示错误，可手动重置。存储被禁用或配额不足时显示错误，不假装保存成功、不覆盖上一次成功的偏好。

## 组件与插件职责

- **`node-slider` 组件**维护通用交互：节点悬浮命中、即时 tooltip、提示定位与退出、键盘与无障碍描述。默认提示来自 `node.label`，不使用有延迟的原生 `title`；可以通过 `showTooltips` 开关及 tooltip 渲染接口复用。悬浮仅展示信息，不触发选择或提交。
- **本插件**维护业务：`model.ts` 将供应商的 `reasoning.efforts[].name` 映射为节点名称，并生成实际模型/推理请求；`portraits.ts` 与设置页维护用户图片偏好；`client.tsx` 负责 DSH 接入。
- `Selector.tsx` 只向组件传入名称、当前值、提交回调和图片控制头。提示的颜色通过 `--ns-tooltip-*` 变量接入 DSH 主题，不复制组件的 hover 状态、定时器或 tooltip DOM。

## 业务接入

- 通过 `conversation.input.model` 的 `priority: -10` 正式覆盖机制接入。原生插件继续运行，卸载本插件后自动恢复原生界面和 `/model`。
- `ctx.modelDirectories.directoryFor(sessionId)` 是唯一模型状态来源，复用其 `store/load/select`；不自行维护模型目录、持久化模型配置或发送供应商 API 请求。图片偏好与此业务状态独立。
- 节点顺序、数量、标签、请求值逐项来自**当前 provider + model** 的 `reasoning.efforts`。没有四档枚举、供应商白名单或 effort 字符串转换。
- 默认选择遵循 `current.reasoningEffort ?? reasoning.defaultEffort`。模型未声明 `defaultEffort` 时，保留原生 `Default` 选项，其请求中省略 `reasoningEffort`。
- 切换模型使用目标模型默认 effort；未知的已持久化 effort 保留原值，展示支持等级按钮供用户主动选择。无等级或仅一个等级时不创建 Slider。
- 拖动只预览，松手提交一次；键盘切换即时提交。请求期间禁用选择，失败显示错误并恢复宿主值；支持 Escape、点击外部关闭、移动端及宿主主题。

设置页使用真实的 `settings.section` 根级 list slot，注册 `{ name, id, order, label: () => string }`；宿主提供 `close()`（本页无需使用）。相关上游契约可查阅 `@deepseek-ai/dsh-client-ui-settings-general/lib/client.js` 的 slot 声明与 General 注册，以及 DeepSeek Harness 源码中的 `packages/client/ui-settings/src/client/contract/slots.ts`；升级宿主时应重新核对。client 依赖声明包含模型选择与设置 shell，不需要新增 composition 条目。`codex-auth/src/client.tsx` 使用同一设置页协议。

## 构建与加载

```sh
# 从仓库根目录执行：
cd model-effort-slider
npm ci
npm run build
npm run watch
```

构建产物遵循 Harness lazy factory 模块协议，React/ReactDOM 复用宿主；CSS 和 slot 注册随插件生命周期销毁。构建只处理源码与文本 CSS，没有图片 loader、复制图片或内嵌图片步骤。`npm run build` 原子替换 `lib/client.js`。

如使用本地安装链接，请将其指向实际插件目录。保留原生 `ui-model-selection`，本插件依赖其服务。是否热更新取决于正在运行的 Harness 构建与 HMR 配置；不要仅因运行本插件 watch 就假定现有页面自动刷新。必要时重新加载现有 GUI 页面，不要启动替代服务器。

## 验证

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```

浏览器测试默认使用 `/opt/google/chrome/chrome`（可用 `CHROME_PATH` 覆盖），在 `15082` 端口启动隔离 fixture 并自动退出。fixture 调用实际 `apply()` 获取选择器和设置注册，不使用另一套设置连接逻辑。测试涵盖动态元数据、跨供应商默认值、鼠标/触摸拖动、拒绝回退、键盘、窄屏、关闭焦点，以及默认无图片/网络请求、上传校验、顺序、持久化、即时更新、跨页同步、存储错误与重置。测试图片仅在内存中由 canvas 生成简单色块，不保存或捆绑图片文件。
