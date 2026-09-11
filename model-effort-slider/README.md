# Model Effort Slider · DeepSeek Harness

以本仓库 `node-slider` React 组件替换 composer 的模型选择器：档位标题、渐变色轨道和供应商分组模型列表。未提供图片或图片加载失败时只显示轨道和节点，不显示图片框或倒三角，并收起上方图片预留空间及隐藏的图片拖拽区域；仍可直接拖动轨道或用键盘操作。上传图片后按图片控制头尺寸自动展开预留空间，仅显示图片框，不附带倒三角。删除全部图片或加载失败时会立即恢复紧凑布局。插件不附带图片，不从外部网站加载图片，也不在构建产物中内嵌图片。

## 自选图片

打开 DSH **设置 → 推理滑块图片**：

- 可添加**任意数量**的任意内容栅格图片，支持 PNG、JPEG 或 WebP（不支持 SVG / GIF）；每张源文件必须大于 0 且不超过 **2 MiB**，解码后宽高均不超过 **4096 像素**。没有图片数量上限，也没有总容量上限：只按单张校验，宿主端总量超过 32 MiB 时拒绝该批并提示先移除部分图片。
- 校验文件类型、文件头与实际浏览器解码结果，居中裁剪为 **160 × 160** PNG。预览、前移/后移、移除或「重置为纯色滑块」均在此页面操作；支持键盘、输入标签与状态/错误播报。多文件按浏览器文件列表顺序追加，可用前移/后移明确排序。任一文件失败则整批不保存。
- 图片按顺序从最低到最高推理等级均匀映射；一张用于所有等级，零张恢复纯色。节点比图片少时只取分布位置的图片，不影响真实 effort 值。
- **图片由宿主端（Node 半）保存**，见下节；不在浏览器 `localStorage` 中保存，也不写入仓库。旧的 `dsh.model-effort-slider.portraits.v1` 键不再读写，旧数据请手动重新添加。
- 同页选择器即时更新；其他标签页在获得焦点或下一次轮询（5 秒）时同步宿主端 revision；打开选择器面板时会立刻重读一次。宿主端不可用时退回纯色滑块并在设置中提示；请求失败显示宿主返回的原因，且不改变已保存的列表。

## 宿主端存储

插件现在同时有 Node 半（`src/index.ts`、`state.ts`、`http.ts`）和浏览器半（`src/client.tsx` 及其组件）：

- Node 半用 `ctx.connection.fetch.register` 在 `/api/dsh-model-effort-slider` 注册**唯一**路由，复用 Harness 原生的 Host/Origin 校验与浏览器 cookie 认证；不需要端口、令牌或 CORS 处理。请求体使用 `buffered` 模式。
- `GET /api/dsh-model-effort-slider` 返回 `{ revision, portraits: [{ id, bytes, url }] }`；`GET /api/dsh-model-effort-slider?id=<id>` 返回该图片的 PNG 字节，支持 `HEAD`。DSH 精确匹配注册路径，不会将子路径自动分发到该处理器。变更通过一次 `POST`（multipart）完成，字段为 `action`（`add` / `remove` / `move` / `reset`），`add` 附带一个或多个 `file`，`remove`/`move` 附带 `id`。
- 落盘位置默认 `$DSH_HOME/model-effort-slider`（未设置 `DSH_HOME` 时为 `~/.dsh/model-effort-slider`），可用环境变量 `DSH_MODEL_EFFORT_SLIDER_HOME` 覆盖。目录内是 `manifest.json`（有序 id + revision，临时文件 + rename 原子替换）与 `portraits/<id>.png`。图片以文件存放，不塞进 JSON 文档。
- 校验在宿主端重做：PNG 签名、IHDR 尺寸必须为 160 × 160、单张 ≤ 512 KiB、单次 ≤ 32 张、总量 ≤ 32 MiB。整批先校验后写入，任一张不合法则整批不落盘。并发变更在单条队列上串行，避免两个标签页互相覆盖 manifest。
- 宿主半缺失（profile 未注册 Node 入口）时，浏览器半把 401/404 视为「宿主不可用」，只提示并退回纯色滑块，不影响模型选择。

## 组件与插件职责

- **`node-slider` 组件**维护通用交互：节点悬浮命中、即时 tooltip、提示定位与退出、键盘与无障碍描述。默认提示来自 `node.label`，不使用有延迟的原生 `title`；可以通过 `showTooltips` 开关及 tooltip 渲染接口复用。悬浮仅展示信息，不触发选择或提交。
- **本插件**维护业务：`model.ts` 将供应商的 `reasoning.efforts[].name` 映射为节点名称，并生成实际模型/推理请求；`portraits.ts`、`api.ts` 与设置页维护宿主端图片偏好；`client.tsx` 负责 DSH 接入。
- `Selector.tsx` 只向组件传入名称、当前值、提交回调和图片控制头。提示的颜色通过 `--ns-tooltip-*` 变量接入 DSH 主题，不复制组件的 hover 状态、定时器或 tooltip DOM。

## 业务接入

- 通过 `conversation.input.model` 的 `priority: -10` 正式覆盖机制接入。原生插件继续运行，卸载本插件后自动恢复原生界面和 `/model`。
- `ctx.modelDirectories.directoryFor(sessionId)` 是唯一模型状态来源，复用其 `store/load/select`；不自行维护模型目录、持久化模型配置或发送供应商 API 请求。图片偏好与此业务状态独立。
- 节点顺序、数量、标签、请求值逐项来自**当前 provider + model** 的 `reasoning.efforts`。没有四档枚举、供应商白名单或 effort 字符串转换。
- 默认选择遵循 `current.reasoningEffort ?? reasoning.defaultEffort`。模型未声明 `defaultEffort` 时，保留原生 `Default` 选项，其请求中省略 `reasoningEffort`。
- 切换模型使用目标模型默认 effort；未知的已持久化 effort 保留原值，展示支持等级按钮供用户主动选择。无等级或仅一个等级时不创建 Slider。
- 拖动只预览，松手提交一次；键盘切换即时提交。请求期间禁用选择，失败显示错误并恢复宿主值；支持 Escape、点击外部关闭、移动端及宿主主题。

Node 入口通过 `inject: ['connection']` 取得路由注册点；浏览器入口继续使用 `slots`、`modelDirectories`、`sessions`。设置页使用真实的 `settings.section` 根级 list slot，注册 `{ name, id, order, label: () => string }`；宿主提供 `close()`（本页无需使用）。相关上游契约可查阅 `@deepseek-ai/dsh-client-ui-settings-general/lib/client.js` 的 slot 声明与 General 注册，以及 DeepSeek Harness 源码中的 `packages/client/ui-settings/src/client/contract/slots.ts`；升级宿主时应重新核对。client 依赖声明包含模型选择与设置 shell，不需要新增 composition 条目。`codex-auth/src/client.tsx` 使用同一设置页协议。

## 构建与加载

```sh
# 从仓库根目录执行：
cd model-effort-slider
npm ci
npm run build
npm run watch
```

构建产物遵循 Harness lazy factory 模块协议，React/ReactDOM 复用宿主；CSS 和 slot 注册随插件生命周期销毁。构建只处理源码与文本 CSS，没有图片 loader、复制图片或内嵌图片步骤。`npm run build` 同时产出 `lib/index.js`（宿主半，ESM）与 `lib/client.js`（浏览器半），两者都原子替换。profile patch 中**已有的那一行** `insert: [{ id: ui-model-effort-slider, name: dsh-model-effort-slider }]` 现在会同时挂载 Node 半与 `dsh.client` 声明的浏览器半，无需新增条目；改完需重载现有 GUI 页面（`patchReload: live` 只重放 profile 补丁，不会自动刷新页面）。

如使用本地安装链接，请将其指向实际插件目录。保留原生 `ui-model-selection`，本插件依赖其服务。是否热更新取决于正在运行的 Harness 构建与 HMR 配置；不要仅因运行本插件 watch 就假定现有页面自动刷新。必要时重新加载现有 GUI 页面，不要启动替代服务器。

## 验证

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```

浏览器测试默认使用 `/opt/google/chrome/chrome`（可用 `CHROME_PATH` 覆盖），在 `15082` 端口启动隔离 fixture 并自动退出。fixture 调用实际 `apply()` 获取选择器和设置注册，不使用另一套设置连接逻辑。测试涵盖动态元数据、跨供应商默认值、鼠标/触摸拖动、拒绝回退、键盘、窄屏、关闭焦点，以及无图默认、上传校验、顺序、宿主持久化、即时更新、跨标签同步、宿主拒绝、宿主缺失降级与重置。fixture 通过真实 Node 半（`src/index.ts` → `apply`）挂载真实路由，浏览器测试打的是实际 `/api` 接口与真实文件系统（每次运行使用独立临时 `DSH_MODEL_EFFORT_SLIDER_HOME`）；规格串行执行，因为一个 fixture 服务器只有一个存储根。测试图片仅在内存中由 canvas 生成简单色块，不保存或捆绑图片文件。
