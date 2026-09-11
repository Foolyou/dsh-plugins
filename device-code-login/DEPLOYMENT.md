# 设备码登录部署指南

本文提供通用操作步骤，不是某台机器或公共部署的验收报告。所有路径、服务名和域名都须替换为自己的配置；`example.net` 是保留示例域名，不能作为真实测试目标。

## 安装与配置

插件只有 Host 代码及自带登录页，无需构建前端或启动第二个 Web 服务。备份实际 Web profile patch 到仓库外的私有位置，保留其他插件，移除或禁用拥有 `/`、`/index.html`、`/login` 的旧登录插件，然后按 [README.md](README.md#configuration) 添加配置。例如：

```yaml
# BEGIN device-code-login
- id: connection
  config:
    trustedHosts: !!js ctx.webRuntime.trustedHosts
    cookieMaxAgeDays: 30
- insert:
    - id: device-code-login
      name: /absolute/path/to/dsh-plugins/device-code-login/src/index.js
      config:
        origins:
          - http://127.0.0.1:12052
          - https://dsh.example.net
        home: /absolute/path/to/runtime-home
        frontendIndex: /absolute/path/to/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html
# END device-code-login
```

YAML 路径须替换成实际绝对路径，不会自动展开本文 shell 变量。插件运行时未指定 home 时仍正常使用 `DSH_HOME`，再回退 `~/.dsh`；**下文操作性脚本不使用这个默认值**。Origins 必须规范且与原生 trusted-host 策略兼容，远程必须 HTTPS，仅本机回环允许 HTTP。每个本地别名均需显式配置。

按自己的 profile reload 策略应用变更；若未激活，由管理员从独立终端重启已有服务，再刷新原地址。不要从该服务的 agent 子进程执行重启。安装位置变化后同步更新 `frontendIndex`、插件入口和 CLI wrapper 路径。

## 本机批准命令

以运行 DSH 的同一 OS 用户、相同 runtime home 执行；`ABCD-EFGH` 仅为示例：

```sh
node /absolute/path/to/dsh-plugins/device-code-login/src/cli.js --home /absolute/path/to/runtime-home list
node /absolute/path/to/dsh-plugins/device-code-login/src/cli.js --home /absolute/path/to/runtime-home approve ABCD-EFGH
node /absolute/path/to/dsh-plugins/device-code-login/src/cli.js --home /absolute/path/to/runtime-home deny ABCD-EFGH
```

核实是自己的浏览器申请后输入 `yes`。只有明确知道申请来源的自动化才使用 `--yes`。可自行安装 PATH 上的 `dsh-device-auth` wrapper；加载插件不会安装 shell 命令。批准只经 `DSH_HOME/device-code-login/approval.sock`，目录 0700、socket 0600，不提供远程 HTTP 批准接口。

## 会话与网络安全

- 配对申请十分钟有效，一次性使用；私密申请凭据只在浏览器页面内存中保存。刷新会重新申请。
- 上述原生 Connection 配置采用 30 天绝对到期 Cookie、HttpOnly、SameSite=Strict；HTTPS 额外带 Secure。插件不会替用户假定有效期配置。
- 授权码、User-Agent、IP 不是经过验证的身份；只能批准自己发起的申请。
- `deny` 只能拒绝待批准请求。已签发 Cookie 不会因替换登录方式失效；无逐设备撤销。
- 远程 TLS 应在可信代理终止，后端绑定回环，不要把明文 HTTP 暴露到公共网络。若使用透明 TCP 转发，应保留原 HTTPS 主机名与证书校验；需另行在实际外部设备验收。
- 本机管理员、TLS 终止机器及被控制的浏览器属于信任边界。Origin/trusted-host 检查不能替代认证。

## 单元测试与真实浏览器验证

在仓库根目录运行单元／集成测试：

```sh
npm --prefix device-code-login test
node device-code-login/scripts/browser-smoke.mjs --help
```

单元测试使用已安装的原生 Connection 和模拟凭据，不代表真实部署已验证。操作性浏览器验证会在**已有服务**创建并批准测试浏览器、访问原生 API/WebSocket，但不调用模型、不保存 Token/Cookie 文件。

请从独立管理员终端设置如下变量，或先人工审阅并加载位于**仓库外**的私有 shell 环境文件。不要提交实际环境文件、凭据、主机名或机器验收报告：

```sh
export DSH_HOME=/absolute/path/to/runtime-home
export DSH_LOCAL_ORIGIN=http://127.0.0.1:12052
export DSH_LOGIN_ORIGIN=https://dsh.example.net
# 以下仅在默认模块／浏览器不可用时设置：
# export PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright/index.mjs
# export CHROME_PATH=/absolute/path/to/chrome
node device-code-login/scripts/browser-smoke.mjs
```

`DSH_HOME`、`DSH_LOCAL_ORIGIN`、`DSH_LOGIN_ORIGIN` **始终必须显式提供**，没有真实部署目标默认值。默认模块为本地可解析的 `playwright`，默认浏览器为其配套 Chromium；按需要安装浏览器或提供上述覆盖项。

`--restart-service` 还须显式 `DSH_SERVICE`（目标 systemd 用户服务名），会真正重启服务。脚本会在任何登录前拒绝从该服务 cgroup 内运行；必须使用服务之外的独立终端，不要从 agent 服务运行。只有愿意中断目标服务时才使用：

```sh
export DSH_SERVICE=your-dsh-web.service
node device-code-login/scripts/browser-smoke.mjs --restart-service
```

验收时检查本机和 HTTPS 登录、Cookie 属性和绝对到期、API/WebSocket、浏览器重开和跨站跳转；重启持久性仅在明确选择重启时验证。真实外部网络和设备仍须单独测试。不要把 fixture 或示例命令描述成部署已经通过。

## 全局撤销浏览器会话（破坏性操作）

`revoke-all.mjs` 会使**所有浏览器会话失效**并重启指定服务，不是逐设备撤销。它先快照非会话凭据以核对保留情况，仅轮换浏览器签名密钥，不应删除 API Key 或 OAuth 记录。它拒绝在目标 DSH 服务 cgroup 内运行。**不要从 agent 服务执行；由管理员在独立终端操作。**

先查看帮助，核对目标 home、服务、CLI 与所有需验证的入口，并做好自己的安全备份：

```sh
node device-code-login/scripts/revoke-all.mjs --help
export DSH_HOME=/absolute/path/to/runtime-home
export DSH_SERVICE=your-dsh-web.service
export DSH_REVOKE_ORIGINS='["http://127.0.0.1:12052","https://dsh.example.net"]'
# 可选：绝对 DSH CLI 入口；否则必须能从 PATH 解析 dsh。
# export DSH_BIN=/absolute/path/to/dsh/bin/dsh.mjs
# 确认所有目标已替换且接受全局注销后，才执行：
node device-code-login/scripts/revoke-all.mjs --confirm-revoke-all
```

确认标志、显式 `DSH_HOME`、`DSH_SERVICE`、`DSH_REVOKE_ORIGINS`（JSON 字符串数组）均必需；没有真实目标默认值。两个操作脚本的 `--help` 可安全查看，不进行服务操作。

## 停用与恢复

删除 profile 中 device-code-login 的 insert 条目，按 reload 策略应用并刷新原页面；可保留 Connection 的 trustedHosts / cookieMaxAgeDays。原生 owner-token 恢复机制仍保留，恢复链接是敏感凭据，仅在自己的浏览器使用，勿贴入聊天或日志。

本插件不修改原生远程设置的 isLoopback 限制，也不会从其他终端导入 API Key；服务需要的凭据应通过受支持的原生配置渠道设置。
