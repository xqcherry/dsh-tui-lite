# 客户端架构

项目是一个 npm 包，以 Cordis 插件形式在随包安装的 dsh 进程中运行。dsh 负责 agent、模型、工具、会话持久化和策略；客户端负责输入、展示和交互。

## 从哪里开始读

| 想理解的功能 | 入口 | 内部职责 |
| --- | --- | --- |
| 输入 | `src/modules/composer/index.ts` | 草稿编辑、撤销、历史、图片、补全、提交、键盘与布局 |
| 消息 | `src/modules/transcript/index.ts` | 事件投影、用量、历史窗口、行签名与具体消息渲染 |
| 会话 | `src/modules/sessions/index.ts` | 会话操作契约、占用账本、恢复标记与投影重置 |
| 设置 | `src/modules/settings/index.ts` | 模型操作、偏好、服务商向导；添加、编辑、发现与认证分开 |
| 审批问答 | `src/modules/decisions/index.ts` | 问题队列、回答取消、审批面板 |
| 任务与子代理 | `src/modules/activity/index.ts` | 任务卡片、分组、子代理展示与数据契约 |
| 聊天主界面 | `src/modules/workbench/index.ts` | 页面、菜单、焦点、通知与命令协调 |

每个模块的 `contracts.ts` 是公开类型入口，`index.ts` 是公开运行时入口；`model/` 放不依赖 React、终端或 dsh 的逻辑，`ui/` 放界面和控制器。跨模块不得访问私有文件。

例如理解输入，先看 `contracts.ts` 的 `ComposerPort`，再看输入组件与 `ui/controllers/` 下的提交、历史、附件和撤销控制器；编辑和图片 token 的纯规则在 `model/`。不必先读终端渲染器。

## 基础设施与宿主接入

- `src/dsh-adapter/`：唯一允许导入官方包的目录，负责 profile、agent、宿主服务、持久化事件翻译与装配。
- `src/shared/protocol/`：规范化事件和跨模块传输数据，不包含业务执行流程。
- `src/shared/platform/`：文件、剪贴板、文本和图像等基础能力，不反向依赖功能模块或界面。
- `src/shared/lifecycle/`、`src/shared/state/`：所有权、退出与只读投影的公共机制。
- `src/ui/`：主题、Markdown、代码框、通用表单及展示工具，不依赖功能模块。
- `src/ui/primitives.ts`：带主题的业务组件入口；`src/terminal/`：渲染、输入和终端恢复门面。
- `src/ink/`、`src/native-ts/`：保留的终端渲染器与布局实现。本轮只调整基础工具的导入路径。

依赖检查覆盖静态导入、类型导入、动态导入和转导出，并检查功能模块之间无依赖环。功能 model 不得依赖 React 或渲染器。

## 启动与数据流

1. `bin/dsh-tui.js` 调用启动器，定位当前安装的 dsh，不搜索全局 PATH。
2. 专用 profile 组合官方 `dsh-base` 与当前 TUI bundle，并链接到当前 npm 安装。用户 patch 继续保留。
3. `dsh-adapter/plugin.ts` 创建或恢复 agent，装配宿主服务、审批问答与工作台。
4. 工作台接收按输入、会话、设置、消息、页面服务分开的能力端口，不接收完整可写客户端对象。
5. 输入经宿主服务送入 dsh；持久化事件和临时流式帧被翻译，再进入消息投影，通知界面渲染。
6. 用户退出先恢复终端再清理宿主；插件卸载只释放当前实例。

持久化 transcript 始终是事实来源。事件顺序、序列锚点、工具调用 ID、绑定 generation、输入 FIFO 和释放事务继续保留。

## 当前迁移边界

本批完成了功能目录、公开入口、组件端口以及输入、消息列表、服务商向导的主要拆分。旧 `src/app/`、`src/tui/`、`src/utils/` 实现已迁移，不保留另一套平行实现。

**完整重构计划仍未全部完成。** `dsh-adapter/runtime/` 内部仍保留装配用的聚合状态；频道仍承担部分会话、任务和子代理编排。下一阶段需要让各模块真正拥有独立状态和通知，再进一步收窄宿主接线。当前不能把目录迁移等同于状态所有权已全部解耦。

`pnpm verify` 默认串行运行检查，避免同时启动多个渲染和图片测试。涉及终端的改动还需窄 TTY 验证，打包另运行 `pnpm verify:package`。
