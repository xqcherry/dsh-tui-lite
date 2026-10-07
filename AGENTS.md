# AGENTS.md

dsh-TUI 是 DeepSeek Harness 的纯插件 TUI；Agent、会话、模型、工具、持久化与策略由宿主负责，本包只消费它们。改动前阅读 [贡献指南](docs/contributing.md) 与 [Adapter 契约](ADAPTER.md)；按需查阅 [架构说明](docs/architecture.md) 和贡献指南中的仓库地图、验证矩阵及跨文件清单。

## 架构边界

- 厂商依赖按目录隔离：`@deepseek-ai/*` 只进 `src/dsh-adapter/`，`@anthropic-ai/*` 只进 `src/backends/claude/`；中立层不依赖厂商或具体后端，UI 不直接依赖后端。完整 import 规则以 [ADAPTER.md](ADAPTER.md) 为准。
- 持久化会话记录是 transcript 真源。事件顺序、序列锚点和 call-ID 必须保持一致；不要插入可能与真源分歧的乐观助手或工具事实。
- 共享投影放 `src/channel/projection.ts`，TUI 动作放 channel，交互与按键优先级放 `src/screens/Chat.tsx`，终端协议与帧差分放 `src/ink/`。通过现有服务接缝接入宿主能力，不在 UI 重实现宿主域服务。
- 上游版本、peer/dev 依赖和 `cordis.patch.yml` 的快照须保持一致；修改时按 [ADAPTER.md](ADAPTER.md) 的升级流程和对应门禁核对。
- Cordis 资源用 `ctx.effect` 或既有退出漏斗清理。渲染失败须非零退出；正常退出须恢复终端状态。TUI 活动期间不用 stdout 诊断，调试走可选的 stderr 路径。

## 修改与验证

- 源码改在 `src/`，不手改或提交生成的 `lib/`。保持纯 ESM、相对导入 `.js` 后缀、`import type`、两空格、单引号和无分号；新代码不用 `any`，不批量格式化 `src/ink/`。
- 终端宽度按显示单元计算，使用现有宽度辅助函数；`src/ink/` 外的尺寸只经 `useTerminalSize()` 获取。例外按贡献指南登记。
- 行为、配置、快捷键或限制变更须同步 `README.md` 与 `README_ZH.md`；其他联动文件按贡献指南的跨文件清单检查。
- 行为、类型、配置或构建输入改动运行 `pnpm build`，再按改动面运行聚焦回归；共享渲染、`Chat`、提示/问卷布局、工具卡、主题原语或 `ink/` core 改动还须跑 CI 回归。终端可见改动在环境允许时演练 inline、fullscreen 和窄宽度。纯文档、workflow、YAML 改动无需本地重建。
- 仓库没有根级 `test` 或 `lint` 脚本。运行 `scripts/` 前读脚本头部，确认它消费 `src/` 还是 `lib/types/`；不要把诊断探针当测试套件全跑。

## 安全与交付

- 不泄露凭证；诊断 `DEEPSEEK_API_KEY` 时只报告是否已设置。
- 创建或更新 PR 一律使用 `.agents/skills/pr`。只暂存显式路径，不运行破坏性 Git 清理命令；未经要求不 commit、打 tag、push 或发布。
- `CLAUDE.md` 是指向本文件的符号链接；修改指引时编辑 `AGENTS.md` 真身，并让规则保持简短、自包含。
