# Codex OAuth for DeepSeek Harness

在 DSH 设置页增加 **Codex 授权**，连接 OpenAI Codex / ChatGPT 账号。适配并实测于 DSH `0.1.5-rc.1`。

## 使用

1. 打开 Harness → **Settings → Codex 授权**。
2. 选择 **设备码登录**（适合 WSL / 远程环境）或 **浏览器登录**。
3. 打开页面中的 OpenAI 授权链接，完成账号登录与授权。设备码模式需输入显示的设备码；浏览器回调未成功时可粘贴跳转地址。
4. 页面自动显示授权完成。回到会话，选择 **openai-codex** 分组中的模型。

设备码登录需先在 ChatGPT 安全设置或工作区权限中允许。此插件提供操作入口，不改变账号本身的模型权限和额度。参见 [OpenAI 认证文档](https://learn.chatgpt.com/docs/auth)。

状态中的「凭据已保存」表示本机 DSH 有 OAuth 凭据，不代表已实时验证账号额度或所有模型权限。

## 原生集成

- Host 调用 `ctx.authorization.begin()`，使用原生 `llm-pi-ai/openai-codex` flow。
- 浏览器／设备码请求、OAuth token 交换、持久化和刷新都由原生 pi-ai / Harness 完成。
- 原生流程拥有的 `select` 提示包含指定模式时自动选择，其余提示按原生字段展示。
- 不读取、复制或修改 Codex CLI 的 `auth.json`；DSH 使用独立授权记录。
- 状态、回答、取消及退出请求经 `ctx.connection.fetch` 注册，继承原生 Host / Origin / cookie 校验。
- Access token、refresh token 和账号 ID 不返回浏览器；上游交换错误不原样返回，以免错误正文带出凭据。
- 页面用随机、保存在 sessionStorage 的标识拥有一次登录；其他标签页只看到忙碌状态，不看到授权链接、设备码或提示。
- 关闭设置页不会取消登录，同一标签页重新进入或刷新可恢复；取消、16 分钟超时和插件卸载会释放未完成流程。
- 退出登录只删除 DSH 本地授权记录，不向 OpenAI 撤销授权，也不影响 Codex CLI 登录。

## 安装与构建

从仓库根目录执行：

```sh
npm --prefix codex-auth ci
npm --prefix codex-auth run build
```

将 `codex-auth` 目录链接到 `~/.dsh/profiles/web/node_modules/dsh-codex-auth`，然后向 `~/.dsh/profiles/web/cordis.patch.yml` 添加：

```yaml
- insert:
    - id: authorization
      name: '@deepseek-ai/dsh-authorization'
    - id: codex-auth
      name: dsh-codex-auth
```

已有 patch 条目应保留。当前默认 Web profile 未启用 `authorization`，因此上面一起挂载该原生服务；若你的 profile 已挂载它，不要重复添加。本插件还需要原生 `credentials`、`connection` 服务，以及提供 Codex flow 的 `llm-pi-ai`。Client 依赖 `ui-settings-general` 声明设置页槽位。

设置 `patchReload: live` 的 Web profile 会热加载新条目。删除上述条目即可停用。Client 重建会由 Harness HMR 热更新；修改 Host 逻辑后需重新加载 Host 插件。

## 验证

```sh
npm --prefix codex-auth run typecheck
npm --prefix codex-auth test
npm --prefix codex-auth run test:browser
```

测试采用模拟原生授权服务，不向 OpenAI 发起登录，也不写真实凭据。覆盖设备码／浏览器登录、手动回调、成功／失败、token 错误隐藏、跨标签页隔离、重复操作、取消／超时／卸载、退出登录和窄屏布局。

浏览器测试启动临时服务于 `15083`，默认使用 WSL Linux Chrome `/opt/google/chrome/chrome`，可用 `CHROME_PATH` 覆盖。
