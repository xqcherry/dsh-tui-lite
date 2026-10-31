# 适配上游 dsh 更新

用户升级一个客户端 npm 包，即获得一组经过验证的 TUI 与 dsh。运行时不自动追踪 latest，不承诺未经验证的历史 RC。RC 只是候选发布版，适配流程与正式版一致。

## 版本来源

`package.json` 中 `dependencies.@deepseek-ai/dsh` 是唯一的目标内核版本。直接使用的官方 dsh 包固定到同一准确版本；Cordis 和 Schemastery 使用各自经过验证的版本。锁文件记录完整依赖树。

`dsh-adapter/contract.ts` 从包声明读取目标版本，启动前检查所需包。验证脚本同时检查客户端与随包 CLI 使用同一个 Cordis、agent 和 session 模块，避免依赖重复造成服务身份不一致。

## 更新步骤

1. 阅读上游发布说明及服务接口变化，重点检查 agent、session、流式帧、commands、preset、审批问答和 profile/bundle 装配。
2. 一起更新目标 dsh 及直接使用的官方包版本，重新生成锁文件。必要时更新框架依赖；不扩大历史版本支持范围。
3. 先修适配层和 bundle；上游未改变用户能力时，不修改界面。只有客户端确实需要新增数据或操作时才调整 `app` 契约。
4. 更新 `verify-upstream-contract.ts` 中明确验证的版本断言，执行 `pnpm build`、相关专项及 `pnpm verify`。消息翻译与投影 golden 发生变化时，先说明语义原因，不直接覆盖预期。
5. 运行 `pnpm pack`，在没有全局 dsh/pnpm 的隔离环境使用 npm 安装 tarball；确认首次启动、帮助、退出、再次启动和升级后的 profile 链接。检查窄 TTY、会话恢复、配置保留及终端模式恢复。

只在上述检查通过后发布新的客户端版本。安装更新通过 npm 完成，TUI 不维护独立的自更新器。

## 保留兼容的边界

旧会话的读取兼容由官方持久化服务和必要的 transcript 适配负责，不因只支持一个运行版本而丢弃用户历史。用户 profile patch、偏好和第三方插件保留；迁移实际改动的 profile manifest 和旧的物理 TUI 安装会保留备份。
