# 客户端架构

项目是一个 npm 包，以 Cordis 插件形式在随包安装的 dsh 进程中运行。dsh 负责 agent、模型、工具、会话持久化和策略；客户端负责输入、展示和交互。

## 从哪里开始读

| 想理解的功能 | 入口 | 内部职责 |
| --- | --- | --- |
| 输入 | `src/modules/composer/index.ts` | 草稿编辑、撤销、历史、图片、补全、提交、键盘与布局 |
| 消息 | `src/modules/transcript/index.ts` | 事件投影、用量、历史窗口、行签名与具体消息渲染 |
| 会话 | `src/modules/sessions/index.ts` | 会话状态、切换事务、占用账本、恢复标记与投影重置 |
| 设置 | `src/modules/settings/index.ts` | 模型操作、偏好、服务商向导；添加、编辑、发现与认证分开 |
| 审批问答 | `src/modules/decisions/index.ts` | 问题队列、回答取消、审批面板 |
| 任务与子代理 | `src/modules/activity/index.ts` | 任务与子代理归约、费用、任务卡片和分组 |
| 聊天主界面 | `src/modules/workbench/index.ts` | 页面、菜单、焦点、通知与命令协调 |

每个模块的 `contracts.ts` 是公开类型入口，`index.ts` 是公开运行时入口；`model/` 放不依赖 React、终端或 dsh 的逻辑，`ui/` 放界面和控制器。跨模块不得访问私有文件。

例如理解输入，先看 `contracts.ts` 的 `ComposerBinding`，再看输入组件与 `ui/controllers/` 下的提交、历史、附件和撤销控制器；编辑和图片 token 的纯规则在 `model/`。不必先读终端渲染器。

## 基础设施与宿主接入

- `src/dsh-adapter/`：唯一允许导入官方包的目录，负责 profile、agent、宿主服务、持久化事件翻译与装配。
- `src/shared/protocol/`：规范化事件和跨模块传输数据，不包含业务执行流程。
- `src/shared/platform/`：文件、剪贴板、文本和图像等基础能力，不反向依赖功能模块或界面。
- `src/shared/lifecycle/`、`src/shared/state/`：所有权、退出与模块快照、批量发布与只读投影的公共机制。
- `src/ui/`：主题、Markdown、代码框、通用表单及展示工具，不依赖功能模块。
- `src/ui/primitives.ts`：带主题的业务组件入口；`src/terminal/`：渲染、输入和终端恢复门面。
- `src/ink/`、`src/native-ts/`：保留的终端渲染器与布局实现。本轮只调整基础工具的导入路径。

依赖检查覆盖静态导入、类型导入、动态导入和转导出，并检查功能模块之间无依赖环。功能 model 不得依赖 React 或渲染器。

## 启动与数据流

1. `bin/dsh-tui.js` 调用启动器，定位当前安装的 dsh，不搜索全局 PATH。
2. 专用 profile 组合官方 `dsh-base` 与当前 TUI bundle，并链接到当前 npm 安装。用户 patch 继续保留。
3. `dsh-adapter/plugin.ts` 创建或恢复 agent，装配宿主服务、审批问答与工作台。
4. adapter 创建六个状态模块与独立审批问答队列；`workbench-bindings.ts` 只向工作台公开各模块的 `store` 和 `commands`。
5. 输入经宿主服务送入 dsh；持久化事件和临时流式帧被翻译，由模块入口归约并发布快照，通知界面渲染。
6. 用户退出先恢复终端再清理宿主；插件卸载只释放当前实例。

持久化 transcript 始终是事实来源。事件顺序、序列锚点、工具调用 ID、绑定 generation、输入 FIFO 和释放事务继续保留。

## 状态与发布

每个状态模块公开 `Snapshot`、`Commands` 和 `Binding`。`store.getSnapshot()` 在状态无变化时返回同一不可变快照；`subscribe()` 只订阅所属模块。界面不再依赖全局版本号。输入控制器通过上下文读取会话、设置和通知事实，调用显式命令。

`src/shared/state/module-store.ts` 提供发布协调器。一次事件批次或会话重置中的所有模块先安装快照，再通知订阅者。流式内容立即进入快照，通知约 16 ms 合并；上游 `wake: none` 提交事实但不主动唤醒界面。历史消息保留 dirty 标记优化，无关状态更新不重新遍历历史行。图片 Buffer 等不透明对象保留原有语义。

模块的 `ingress` 仅供运行时接线使用：`patch/update` 写入，`read()` 读取同批操作中的当前事实。它不会交给 UI。transcript 的私有 reducer 保留工具调用与消息行身份；activity 通过 transcript 入口更新任务行，不持有消息数组。审批问答保留已有独立队列。

## 会话与宿主边界

`sessions/model/session-switch.ts` 协调准备、竞争检查、采用和放弃；adapter 提供实际 agent、绑定、句柄和持久化服务。提交前失败保留旧会话，提交后初始化失败撤销新绑定并报错。批量重置和重放完成后才通知界面；generation 继续隔离过期回调。

`dsh-adapter/module-runtime.ts` 是装配类型，组合模块引用和资源释放，不保存另一份聚合状态。旧 `runtime/` 中的完整 `Client`、`ClientState`、初始状态和界面选择器已移除。adapter 仍负责官方事件订阅、宿主资源与模块的连接；终端渲染器和键盘布局控制器继续保留。

`pnpm verify` 默认串行运行检查，避免同时启动多个渲染和图片测试。涉及终端的改动还需窄 TTY 验证，打包另运行 `pnpm verify:package`。本阶段实施与验收范围见 [模块状态计划](superpowers/plans/2026-10-31-module-state.md)。
