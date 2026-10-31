# 开发规范

- 修改 `src/`，不手改生成目录 `lib/`。使用 ESM TypeScript、`.js` 相对导入、`import type`、两空格、单引号、无分号，避免 `any`。
- Harness 负责 agent、模型、工具、会话、持久化与策略；UI 通过现有 adapter/channel 服务接入。`@deepseek-ai/*` 导入仅放在 `src/dsh-adapter/`。
- 持久化 transcript 是事实来源；保留事件顺序、序列锚点和 tool call ID，不虚构 assistant/tool 状态。
- 改动保持单一目的，避免无关重构。不记录凭据；TUI 运行时诊断信息不得写入 stdout。
- 代码改动须通过 `pnpm build`、相关专项检查和 `pnpm verify`；终端界面改动另须在窄 TTY 中验证。纯文档改动检查 diff 即可。

## Git 规范

- 开工前检查分支和工作区，保留用户已有改动；从最新 `main` 创建 `feat/<主题>`、`fix/<主题>` 或 `docs/<主题>` 分支。
- 新功能必须在独立分支开发，验证通过后合并回 `main`，禁止直接在 `main` 开发；不要求创建 PR。
- 提交保持小而完整，使用 `feat:`、`fix:`、`docs:`、`refactor:` 等 Conventional Commits 前缀；只暂存明确路径，不混入无关文件或密钥。
- 合并前检查 diff 和验证结果，确保不混入无关改动；合并冲突须确认处理正确后重新验证。
- 未经用户明确要求，不执行 commit、push、合并、打标签或发布；不覆盖他人历史，不擅自丢弃工作区改动。
