# DSH Plugins Bundle

本仓库的 **DSH 官方 Bundle 组合包**，兼容验证基线为 DSH `0.1.5-rc.1`。不是运行时聚合插件，也不是设置页里的 Agent preset。通过 `dsh.bundle.patch` 提供默认加载清单，用户通过自己的后置 patch 覆盖选择。

## 包含什么

| 稳定 entry ID | 功能 | 默认状态 |
| --- | --- | --- |
| `ui-model-effort-slider` | 模型 / 推理档位与宿主端图片 | 开启 |
| `authorization` | Codex 授权所需的官方服务 | 开启 |
| `codex-auth` | Codex 授权设置页 | 开启（不会自动发起登录） |
| `provider-balance` | 供应商余额 / 额度显示 | 开启 |
| `ui-mobile-sidebar-layout` | 独立手机抽屉布局分支 | **关闭，显式替换官方布局后启用** |
| `device-code-login` | 浏览器设备码登录机制 | **关闭，显式配置后启用** |

`node-slider` 是模型滑块的组件依赖，不单独挂载。组合包通过 `dependencies` 携带普通插件；只安装依赖不会自动激活它们，实际 entry 来自 `cordis.patch.yml`。

手机布局保留官方 manifest / 浏览器 factory 身份，不能用裸包别名加载。构建会将它的产物、最小 manifest 和原 MIT 许可证放进 `bundle/lib/mobile-sidebar-layout`，然后通过**相对组合包 patch 的文件路径**加载。不会替换 DSH 安装目录中的官方文件。该私有分支不能以官方包名发布。

## 首次安装（源码 checkout）

这些插件目前是私有源码工作区，**未发布到 npm registry**。下面使用完整 checkout 的 `link:` 安装，不声称一个包含兄弟 `file:` 依赖的独立 tarball 可以移到任意机器使用。

要求 Node >= 22，npm、DSH 及 `dsh plugin` 所需的 pnpm 可执行。

```sh
# 在本仓库根目录执行：
npm ci --ignore-scripts
npm run build

# 使用 checkout 的绝对路径；DSH_HOME 使用你实际运行服务的 home。
dsh plugin --profile web add "link:$(pwd)/bundle"
```

官方 `dsh plugin` 会将直接安装的 Bundle 加入该 profile 的 `dsh.profile.bundles`。确认它排在官方层之后：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-plugins-bundle"
      ]
    }
  }
}
```

保留完整 profile 中已有的其他字段及其他 bundle；上例仅展示相关字段。**如果已经手工加载本仓库插件，先看下面的迁移步骤，不要叠加启用重复 entry。**

组合顺序为：官方 bundles → 本组合包 → profile patch → home patch → 命令行 `--patch`。不得将本组合包同时写入 `bundles` 和普通插件 insert 列表。

## 更新：不再手写插件清单

```sh
# checkout 根目录：只快进拉取，不 reset、不 stash 用户更改。
npm run update:bundle
```

该命令执行 `git pull --ff-only`、按根锁文件安装依赖并依次构建组件、插件与组合包。日后新增普通插件，由维护者更新工作区、组合包依赖和 patch；用户不用逐项补清单。

更新仍需按部署方式**重新加载宿主进程并刷新原 GUI**，尤其是 Host 代码、组合包 patch 或依赖图变化时。`patchReload: live` 监视的是用户 patch，不等于重新读取组合包或重新导入所有源码。更新命令不重启服务、不改认证、不启动替代服务器。

## 用户覆盖

写在自己 profile 的 `cordis.patch.yml`，不是编辑组合包。禁用某个功能：

```yaml
- id: provider-balance
  disabled: true
```

修改插件配置：

```yaml
- id: some-entry-id
  config:
    someOption: someValue
```

上例为语法示意，实际字段以各插件支持的配置为准。**config 整体替换，不做深度合并**；已有 patch 的 `name` 是断言，不是替换插件名的操作。禁用 Codex 页面可以只禁用 `codex-auth`；确认没有其他使用者时也可禁用 `authorization`。

### 可选：手机布局

在用户 patch 同时写两条，确保只有一个布局模块处于启用状态：

```yaml
- id: ui-layout
  disabled: true
- id: ui-mobile-sidebar-layout
  disabled: false
```

恢复官方布局则将两者分别改为 `false`、`true`。兼容基线和人工验收见 [手机布局说明](../mobile-sidebar-layout/DEPLOYMENT.md)。

### 可选：浏览器设备码登录

必须显式选择并配置，不随更新自动开启。**不要再 insert 同名 entry**，使用组合包预留的 ID：

```yaml
- id: connection
  config:
    trustedHosts: !!js ctx.webRuntime.trustedHosts
    cookieMaxAgeDays: 30
- id: device-code-login
  disabled: false
  config:
    origins:
      - http://127.0.0.1:12052
      - https://dsh.example.net
    home: /absolute/path/to/runtime-home
    frontendIndex: /absolute/path/to/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html
```

替换所有示例路径、端口、域名；原 Connection 的其他配置需要一并保留。先移除其他冲突的登录 owner。完整信任边界、批准 CLI 和恢复办法见 [设备码登录部署指南](../device-code-login/DEPLOYMENT.md)。

## 从逐项加载迁移

迁移工具只处理已识别的根级 entry，保留其他插件、完整 config、`!!js` 表达式和显式禁用。已有手机布局 / 设备码登录会转换成显式开启的覆盖，不会重置它们的配置。未知同 ID 插件、重复 insert 或嵌套条目会拒绝自动迁移，交由用户处理。

1. 构建整个工作区。
2. 先只读预览（不打印私密配置）：

   ```sh
   npm run bundle:profile -- --profile-dir /absolute/path/to/runtime-home/profiles/web
   ```

3. 从**服务之外的管理员终端**停止原 DSH 服务，防止 live patch 在两个文件更新之间看到半迁移状态。不要从该服务内的 Agent 进程直接停止自身。
4. 用上述 `dsh plugin --profile web add "link:$(pwd)/bundle"` 安装组合包。
5. 应用迁移：

   ```sh
   npm run bundle:profile -- --profile-dir /absolute/path/to/runtime-home/profiles/web --apply
   ```

   工具为 `package.json` 和 `cordis.patch.yml` 建立 profile 内的私有备份，逐文件原子替换；重复执行不产生重复条目。它不改 home 级 patch，**若 home 级或其他 bundle 也 insert 相同 ID，需先人工去重**。
6. 用 `dsh --profile web --dump-config` 检查最终树后，再启动原服务、刷新原地址。dump 可能包含私密配置，不要提交输出；它会更新 profile 生成的 `cordis.yml`，不代表实际 Host/浏览器已经激活。

迁移不会删除图片、API Key、OAuth 记录或浏览器会话。旧 profile 中单独安装的插件依赖/链接不会被擅自删除；可在确认无其他用途后自行清理。显式旧链接可能优先于官方投影路径，应确保指向同一 checkout，避免更新了组合包却仍加载旧插件副本。

## 验证与回滚

```sh
npm run typecheck
npm test
npm run test:integration
```

集成测试默认查找全局安装的 DSH，也可设置 `DSH_INSTALL_DIR=/absolute/path/to/dsh`。所有 profile 放在临时目录；使用官方组合、依赖投影、Loader 和 ClientModuleRegistry 验证 host 入口导入 / 浏览器产物发现，不启动第二个 GUI，不访问真实凭据。浏览器交互仍由各插件的 `test:browser` 验证；这不等于真实部署验收。

回滚时先停止原服务，恢复迁移工具保存的两份配置（只在迁移后没有其他修改时直接恢复；否则手工合并），再启动原服务。若要完全移除组合包，先移除只针对其 ID 的覆盖，再从 `dsh.profile.bundles` 移除它；按需删除依赖。不要以清空运行时数据目录作为卸载步骤。
