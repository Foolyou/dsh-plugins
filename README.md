# DSH Plugins

DeepSeek Harness Web UI 组件与插件。

| 目录 | 内容 |
| --- | --- |
| [bundle](bundle/README.md) | 官方 DSH Bundle：统一加载、可选功能、配置迁移与一条命令更新 |
| [node-slider](node-slider/README.md) | 支持自定义节点、控制头、颜色、鼠标、触控及键盘操作的 React Slider |
| [model-effort-slider](model-effort-slider/README.md) | 基于原生模型目录的模型 / 推理档位选择器，可选宿主端落盘的自选图片、无图紧凑布局和即时节点提示 |
| [codex-auth](codex-auth/README.md) | 设置页中的 Codex OAuth 授权，支持浏览器／设备码登录、状态恢复、取消和退出 |
| [provider-balance](provider-balance/README.md) | 跟随当前供应商的 DeepSeek 官方余额与 Codex 订阅 5 小时／周剩余额度 |
| [mobile-sidebar-layout](mobile-sidebar-layout/README.md) | 独立布局分支：手机端零占位贴边展开按钮与抽屉侧栏，保留官方侧栏功能及桌面行为 |
| [device-code-login](device-code-login/README.md) | 本机命令批准浏览器设备码，支持本机 HTTP／远程 HTTPS，复用 DSH 原生 30 天会话；已替代并移除旧 Tailscale 身份登录插件 |

## 推荐：官方 Bundle 一次安装

[**dsh-plugins-bundle**](bundle/README.md) 使用 DSH 原生 `dsh.bundle.patch` / `dsh.profile.bundles`，统一维护依赖和插件加载清单，不另写运行时加载器。模型滑块、Codex 授权入口和余额显示默认启用；手机布局替换、浏览器设备码登录必须显式选择。独立插件仍可单独使用。

当前提供完整源码 checkout 的本地安装（尚未发布 npm 包）。要求 Node >= 22，npm、DSH 和 pnpm 可用。在仓库根目录执行：

```sh
npm ci --ignore-scripts
npm run build
# 使用与运行服务相同的 DSH_HOME：
dsh plugin --profile web add "link:$(pwd)/bundle"
```

官方插件管理命令会将 Bundle 加入 profile。**已有逐项加载配置时不要直接叠加**；按[迁移说明](bundle/README.md#从逐项加载迁移)先预览、停服、安装并迁移，保留原配置且避免重复 entry。

后续更新只需：

```sh
npm run update:bundle
```

它只快进拉取、按根锁文件安装并按依赖顺序构建，不清理运行时数据、不擅自重启服务。加载新的 Host/组合层后仍需按部署方式重启已有 DSH 并刷新原 GUI，不必重新手写插件清单。关闭单项功能、选择手机布局或配置登录机制，见 [Bundle 用户覆盖](bundle/README.md#用户覆盖)。

## 从源码构建

根工作区统一安装依赖，构建顺序为 `node-slider` → 插件 → Bundle。`npm run build` 构建所有产物；需要时可用 `npm run build --workspace dsh-model-effort-slider` 单独重建一个插件（组件依赖须已构建）。编译产物与 `node_modules` 不纳入 Git，根 `package-lock.json` 纳入版本控制。

## 验证

```sh
# 整个工作区：
npm run typecheck
npm test
# 对已安装 DSH 的真实组合 / 依赖 / 双端产物发现测试，不启动额外 GUI：
npm run test:integration

# 也可按组件分别运行：
npm --prefix node-slider run typecheck
npm --prefix node-slider test
npm --prefix model-effort-slider run typecheck
npm --prefix model-effort-slider test
npm --prefix model-effort-slider run test:browser
npm --prefix codex-auth run typecheck
npm --prefix codex-auth test
npm --prefix codex-auth run test:browser
npm --prefix provider-balance run typecheck
npm --prefix provider-balance test
npm --prefix provider-balance run test:browser
npm --prefix mobile-sidebar-layout test
npm --prefix mobile-sidebar-layout run test:browser
npm --prefix device-code-login test
```

隔离浏览器测试的 Chrome 默认路径为 `/opt/google/chrome/chrome`，可通过 `CHROME_PATH` 指定本机路径；模型选择器测试服务使用端口 `15082`，授权插件使用 `15083`。这些 fixture 测试不代表真实部署已通过验证。

`device-code-login/scripts/browser-smoke.mjs` 是针对已有服务的操作性验证，会批准测试浏览器但不调用模型；必须显式设置 `DSH_HOME`、`DSH_LOCAL_ORIGIN` 和 `DSH_LOGIN_ORIGIN`。默认使用本地可解析的 `playwright` 及配套 Chromium；需要覆盖时设置 `PLAYWRIGHT_MODULE` 和／或 `CHROME_PATH`。`--restart-service` 另需 `DSH_SERVICE`，会重启真实服务，并在登录前拒绝从目标服务 cgroup 内执行。环境配置、风险及全局会话撤销说明见 [device-code-login 部署指南](device-code-login/DEPLOYMENT.md)。这些操作没有真实部署目标默认值。

模型、供应商、effort 数量、顺序和提交值由 Harness 原生目录决定，effort 档位没有数量上限。仓库不附带图片素材；如需自定义控制头图片，请在 DSH「设置 → 推理滑块图片」中添加，图片由该插件的 Node 半保存到 `$DSH_HOME/model-effort-slider`（同一 DSH 的所有浏览器可见，数量不设上限），详见[插件说明](model-effort-slider/README.md)。

## 许可证

本仓库自有代码和文档采用 [MIT License](LICENSE)，Copyright (c) 2026 Chen An。`mobile-sidebar-layout` 中源自上游的模块保留其 [MIT 许可证与 DeepSeek 版权声明](mobile-sidebar-layout/LICENSE)，并非由根许可证替换。来源与第三方依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
