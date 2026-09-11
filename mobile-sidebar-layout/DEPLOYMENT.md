# 安装与回滚

这是独立维护的布局分支，不覆盖 DSH 安装目录中的文件。兼容基线为 `@deepseek-ai/dsh-client-ui-layout` / DSH `0.1.5-rc.1`，不是对其他版本兼容性的保证。

## 加载方式

为保持官方插件的模块依赖兼容，本包 manifest name 和浏览器 factory ID 保留 `@deepseek-ai/dsh-client-ui-layout`。通过 Host 入口的**绝对路径**加载。**不要同时启用原版和本分支**：二者提供相同模块身份、`layout` 服务和 root 插槽。

先按 README 构建本包。备份自己的 Web profile patch 到仓库外的私有位置；不要提交真实配置。默认运行时 home 可为 `~/.dsh`，非默认部署请使用实际 `DSH_HOME`。在实际 Web profile 的 `cordis.patch.yml` 中追加以下区块，替换示例绝对路径，保留已有自定义条目：

```yaml
# BEGIN mobile-sidebar-layout
- id: ui-layout
  name: '@deepseek-ai/dsh-client-ui-layout'
  disabled: true
- insert:
    - id: ui-mobile-sidebar-layout
      name: /absolute/path/to/dsh-plugins/mobile-sidebar-layout/lib/index.js
# END mobile-sidebar-layout
```

非 insert 行中的 `name` 是断言，不是重命名操作，故须禁用原条目并插入新条目。不要改 shipped composition、安装链接或官方依赖目录。不要用与 manifest name 不同的裸包别名：加载器会用裸包名匹配 manifest；绝对文件路径不受此限制。不要向注册表发布这个保留官方名称的私有分支。

按自己的 profile reload 策略应用配置；若运行时没有激活变更，由管理员在独立终端重启已有服务。刷新**现有 GUI 地址**以接收新插件图，不要另建 Web 服务。源文件变化先重新 build；本文不承诺免刷新热更。移动目录后同步更新 patch 绝对路径。

## 配置校验

在仓库根目录执行只读校验（不启动额外 Host、不重写 profile）。先设置真实路径：

```sh
export DSH_PROFILE_DIR=/absolute/path/to/runtime-home/profiles/web
export DSH_INSTALL_DIR=/absolute/path/to/dsh
node mobile-sidebar-layout/scripts/check-profile.mjs \
  "$DSH_PROFILE_DIR" "$DSH_INSTALL_DIR"
```

校验核对组合语义、原布局禁用、新条目唯一性、入口可解析和客户端 bundle 存在，**不等同于浏览器已激活或部署已通过验收**。

## 验收

按 [VERIFICATION.md](VERIFICATION.md) 在自己的已登录页面验收。不要为测试导出、恢复或绕过登录凭据。隔离 fixture 截图不能作为真实 DSH 页面验证证据。

## 回滚

1. 删除 patch 中 `# BEGIN mobile-sidebar-layout` 到 `# END mobile-sidebar-layout` 的完整区块。
2. 按运行时 reload 策略应用配置，必要时由管理员重启已有服务，再刷新原页面恢复官方布局。
3. 如配置后来有其他变更，不要用旧备份整文件覆盖当前配置。独立源码可保留。

## 上游完整性

本分支基于上游 `0.1.5-rc.1` 的 577 行 client bundle，保留 [原 MIT 许可证](LICENSE)。如需审计官方包未被修改，请在自己的安装上记录改动前后的包版本和文件摘要，将机器路径及审计报告保存在仓库外。这里不提供某台机器的摘要作为通用安装证明。
