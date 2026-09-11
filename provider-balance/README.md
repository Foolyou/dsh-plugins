# Provider Balance · 余额与订阅额度

永久安装的 DeepSeek Harness Web 插件，适配 DSH `0.1.5-rc.1`。输入框旁根据**当前会话选中的供应商**展示账户用量，不以模型名称猜测供应商。

- **DeepSeek 官方**（`deepseek-official`）：显示总余额，保留上游币种及金额，不合并不同币种。
- **Codex 订阅**（`openai-codex`）：显示上游提供的 **5 小时／周剩余额度百分比**，`100 − used_percent`；悬停可查看重置时间。
- 其他供应商、非官方网关、非 OAuth Codex、没有可识别额度窗口时隐藏，不占空间。
- 自动跟随模型切换；页面可见时每分钟查询，重新聚焦及点击可刷新。Host 合并并发请求，成功结果缓存 45 秒，查询失败缓存 15 秒，避免反复点击打满接口。
- 查询失败显示不可用，不把未知余额／额度误当成零。只展示账户读数，不统计会话费用，不发送模型推理请求。

## 原生凭据与安全

无需新填 API Key。DeepSeek 使用原生 `settings.get('llm-deepseek')` 解析后的 `apiKeyEnv`、`baseURL` 和 `credentials.resolve()`；遵循启动环境的 `DEEPSEEK_BASE_URL`。仅接受 `https://api.deepseek.com` 的根路径或 `/v1`，自定义网关不查询。

Codex 接受设置页生成的空 `headers: {}`（它不覆盖任何请求头）；非空自定义请求头仍保守隐藏，避免查询与实际模型请求不同的账号。

Codex 读取 DSH 已有的 `llm-pi-ai/openai-codex` OAuth 记录，不读 Codex CLI 的 `auth.json`。临近过期时，在原生 `credentials.modifyRecord()` 锁内复查并刷新，复用 pi-ai `0.85.1` 的官方供应商 OAuth 实现；不自行发起登录，不复制账号凭据。

所有余额查询与凭据处理都在 Host。Client 只接收供应商、余额／额度、更新时间／重置时间；不接收密钥、账号 ID、token 或原始上游错误。查询固定 HTTPS 地址，禁止重定向，15 秒超时，响应大小上限 256 KB。缓存键为凭据指纹，切换账号／退出登录不会复用旧账号缓存。卸载取消请求并释放路由、界面、计时器。

`/api/provider-balance?sessionId=…` 通过原生 `connection.fetch` 注册，继承 Harness 的 Host、Origin 和 Cookie 校验；不增加未鉴权的独立服务。Host 读取会话的待应用模型选择，其次最近请求，最后默认模型；不会为查询余额唤醒已卸载的会话。

## 构建与安装

```sh
npm --prefix provider-balance ci
npm --prefix provider-balance run build
```

将本目录链接到当前 Web profile 的 `node_modules/dsh-provider-balance`，保留已有条目并在该 profile 的 `cordis.patch.yml` 添加：

```yaml
- insert:
    - id: provider-balance
      name: dsh-provider-balance
```

默认 home 下的 Web profile 通常位于 `~/.dsh/profiles/web/`；非默认部署请使用实际 profile 路径。插件属于 Host composition，不是 agent preset；不需要修改部署自带 preset 或 Harness 核心代码。依赖原生 `connection`、`credentials`、`settings`、`sessions`、`sessionProjections`、`agentDefaultModel` 服务，以及 Web conversation/model-selection 插件。

Client 的 `modelDirectories.directoryFor()` 会通过调用者上下文读取 `remote.session`，因此 Client 同时声明 `remote` 和 `remote.session` 注入依赖，避免首次打开会话时发生依赖访问错误。

`patchReload: live` 的 profile 可加载新增条目。安装后刷新当前 GUI；未启用 live reload 的 profile 需重启 Harness。修改源码后先重建插件；Host 必须通过框架 HMR 清除对应模块缓存并重新加载，或重启 Harness。仅停用／启用同名条目可能仍使用 Node 缓存中的旧代码，刷新浏览器也不能更新 Host。不能仅凭 HMR 接收器存在假定源码已生效。

删除上面的 patch 条目即可停用，保留构建目录便于恢复。无需删除任何授权记录。

## 测试

```sh
npm --prefix provider-balance run typecheck
npm --prefix provider-balance test
npm --prefix provider-balance run test:browser
```

单元测试使用模拟凭据与网络，不操作真实账号。浏览器测试使用本地内存页面、模拟接口和 Chrome，不启动替代 Harness 服务。默认 Chrome 路径 `/opt/google/chrome/chrome`，可通过 `CHROME_PATH` 覆盖。

`node scripts/verify-live.mjs`（在本目录内运行）须显式设置 `DSH_SESSION_ID` 和 `DSH_GUI_ORIGIN`，访问指定的已有 GUI 并查询当前会话，没有真实目标默认值。Origin 必须是规范 HTTPS 或 HTTP 回环地址，无路径或尾随斜杠，例如 `https://dsh.example.net`（保留示例域名，须替换）。此操作性脚本默认使用 Playwright 自带 Chromium，可用 `CHROME_PATH` 覆盖；只记录 HTTP 状态、响应类型、窗口名称和错误计数，不记录余额、账号或 token。若独立测试浏览器返回 401，脚本明确失败而不恢复／绕过进程认证；请在已有登录态的 GUI 中刷新，核对实际余额／额度。

## 接口限制

- [DeepSeek 余额接口](https://api-docs.deepseek.com/api/get-user-balance/)：`GET /user/balance`，显示 `balance_infos[].total_balance`。
- Codex 使用 ChatGPT 的 `GET /backend-api/wham/usage`，不是 OpenAI API 平台账单。此接口不属于稳定公共 API，可能因账号权限、代理、限流或服务端变更而暂不可用。
- 根据 `limit_window_seconds` 识别 18000 秒／604800 秒窗口，不把 primary 固定当 5 小时，也不把缺失窗口猜成 100%。不展示 code-review 独立额度、按量 credits 或无法识别的窗口。
- 额度是最近一次上游读数，不是逐 token 实时计费，也不能预测剩余可发消息数。
