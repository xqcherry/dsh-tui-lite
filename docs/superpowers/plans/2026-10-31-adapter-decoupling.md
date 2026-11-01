# dsh-adapter 职责解耦实施计划

用户批准的目标：模块拥有客户端业务，adapter 负责 dsh 接入，保持行为、命令签名、持久化格式和终端底座。

## 全局约束

- 只改 src，不手改 lib；官方导入仅在 dsh-adapter。
- 保留事件顺序、批次预处理、reset 分段、序列锚点、tool call ID、generation、FIFO、释放事务。
- 独立快照、原子发布、16ms 合并及 wake:none 语义保持不变。
- 不改 ui/terminal/ink/native-ts 的实现，不新增全局状态或命令总线。
- 新建、恢复、模型 fork 复用交接机械流程，但保留各操作现有政策、失败结果和副作用顺序。
- 不提交、合并、推送、发布。主任务串行、单核、nice19 构建和测试。

## Task 1: 模块语义写入口与事件协调

将跨模块任意 patch/update 改为自有语义入口，移除 ProjectionHost 中跨模块写权限。事件批次预处理及 transcript 投影协调迁入 workbench/model，按原阶段执行同步 effects。复用原消息 golden，补充顺序和发布回归。

## Task 2: 会话交接

sessions 拥有新建/恢复/模型 fork 客户端准备、采用、放弃流程。adapter 保留真实句柄、reservation、官方持久化、preset、工作区挂接和资源释放。跨模块 reset 使用模块自有入口及工作台协调器。模拟宿主覆盖各操作顺序与失败/竞争/恰好一次清理。

## Task 3: 设置

settings 拥有模型目录缓存、推理强度、回退、偏好和异步 fence。adapter 实现查询/应用宿主端口。通过注入回调调用模型交接，不暴露真实 agent/Context。测试过期响应、缓存、回退和实例释放。

## Task 4: 输入

composer 拥有 FIFO、排队、撤回、取消收敛、图片引用有效性。adapter 保留 tui/input、官方消息附件创建、pre-step 钩子与文件服务。入队捕获原会话及附件，保留取消回执、dock、exactly-once上下文和切换隔离。

## Task 5: 任务与工作台

activity 拥有任务/子代理状态及展示投影，adapter 保留宿主授权、attachment token、游标和订阅生命周期。Chat 的命令路由与业务协调提取到工作台控制器，保留 React 菜单/焦点/键盘。审批问答队列保持独立。

## Task 6: 装配收敛与验收

各模块自己构造 commands。删除中央 RuntimeCommands/ChannelActionDelegates 转发与完整 CoreChannel 服务参数；只允许装配根组合模块引用，专业服务接收窄端口。加强边界检查，更新架构文档。每阶段 build、相关专项、verify；最终 68列TTY、verify:package、diff审查。

## 最终验收记录

六项实施完成。模块通过自己的语义入口写入状态，独立构造并管理公开命令；中央全量命令表、转发注册表和 readiness 接口已删除。adapter 专业服务改用窄读取接口和明确操作，完整运行时仅留在装配入口。会话、设置、输入、任务与主界面流程均有独立模块逻辑。

- `pnpm build` 通过。
- `pnpm verify` 49/49 通过，包含原有回归、11 项新增专项与 68 列 TTY 启动/帮助/退出/终端恢复。五份消息 golden 预期未修改。
- `pnpm verify:package` 通过：真实 npm 包在临时前缀安装随包内核，不依赖全局 dsh/pnpm，重复启动和包内 68 列 TTY 检查通过。沿用 `npm_config_prefer_offline=true` 使用已有 npm 缓存。
- 独立整体验收审查完成，无新增 P1/P2 或阻塞性范围缺口；`git diff --check` 通过。

回归过程中发现并修复了命令提取中的登录回调遮蔽、模块公开入口导入、恢复历史时替换工具对象身份、可选子代理能力丢失和新接口测试夹具缺项。新增检查覆盖相应行为；最终完整回归重新执行通过。

执行约定：从当前重构成果 fc53400 创建 `feat/adapter-decoupling`，保留原工作区，不额外创建 worktree；本地 main 仍是初始版本。原阶段保留既有 new/resume/model-fork 的差异与异常清理边界；2026-11-01 经用户确认，将下述 reservation 异常释放修复纳入收尾。未提交、合并、推送或发布。临时日志、阶段报告和审查证据在忽略的 `.local/adapter-decoupling/` 中保留，便于复核。


## 2026-11-01 收尾复核

本次按 [收尾计划](2026-11-01-adapter-decoupling-closeout.md) 重新检查当前工作区，旧验收记录不代替本次检查。

### 六项目标与证据入口

| 原任务 | 当前代码入口与职责 | 对应专项 |
| --- | --- | --- |
| 语义写入口与事件协调 | 各模块 `model/module.ts` 私有写状态；`workbench/model/session-batch.ts` 保留整批预处理、generation 检查和 reset 分段；`workbench/model/projection.ts` 同步协调语义 effects | workbench-events、module-store、projection-golden、dsh-translate、adapter-composition |
| 会话交接 | `sessions/model/session-switch.ts`、`new-session-planner.ts`、`session-transitions.ts` 拥有各操作政策；adapter binding 保留真实资源、采用与撤销权；workbench 协调模块重置 | new-session-planner、session-transitions、binding-transaction、session-adoption、session-reset |
| 设置 | `settings/model/model-actions.ts` 管理模型缓存、推理强度、回退与异步 fence；adapter 只提供官方查询及选择应用 | settings-actions、model-configuration、model-route |
| 输入 | `composer/model/input-queue.ts`、`image-capabilities.ts` 和 `actions.ts` 拥有 FIFO、图片能力、取消与 dock 收敛；adapter 保留输入政策、附件构造和 pre-step | composer-delivery、prompt 系列、image 与 clipboard 专项 |
| 任务与工作台 | activity 的 job-presentation / subagent-projection 管理展示归约；workbench 的 chat-commands 与 settings 的 configuration-check 对应命令路由和配置检查；Chat 保留 React 交互 | activity-presentation、activity-owners、workbench-commands |
| 装配收敛 | 六模块各自构造 commands 和生命周期；完整运行时只在两个装配入口组合，专业服务使用窄端口；公开 UI 仅取得 store/commands | adapter-composition、module-command-lifecycle、feature-ports、feature-modules、boundaries |

设置配置检查的实际入口为 `settings/model/configuration-check.ts`；工作台命令路由入口为 `workbench/model/chat-commands.ts`。上述为实现与专项映射，不以文件拆分本身作为完成证据。

### 本次新增修复

- resume：reserve 成功后的 compaction 与竞争检查纳入原有 finally，compaction 抛错也释放 reservation。
- model fork：preset、候选准备、挂接和取消纳入 finally；候选清理抛错不再跳过 reservation 释放。局部释放保护保留 prepare 失败时先释放再通知的顺序，避免重复终结。
- 新增失败回归先在原源码复现三条漏释放路径，修复后通过；延迟清理测试同时检查清理完成前不释放、拒绝错误继续传播、释放恰好一次以及不采用候选。reserve 拒绝时不调用终结方法。延迟清理的等待保证针对取消路径中显式 `await abandon(candidate)` 的操作；采用失败仍由 binding 同步撤权并启动异步关闭，本次不将同步采用事务改为异步，也不改变该既有释放边界。
- 未修改公开接口、正常操作顺序、持久化格式、终端底座或五份消息 golden 预期。原审查将 compaction/preset 释放缺口列为本轮之外的决定，自本次起不再适用于当前源码。

### 本次验证结果

- `pnpm build`：通过。
- 会话交接、真实 binding 事务、语义采用、adapter 装配、命令生命周期、事件协调和 golden 共 8 项专项：全部通过。
- `pnpm verify`：49/49 通过，包含源码运行时 68 列真实 TTY 的启动、帮助、退出和终端恢复。新增场景扩展原 session-transitions 检查，因此检查总数保持 49。
- `npm_config_prefer_offline=true pnpm verify:package`：通过；重新构建后，真实 npm 包在临时前缀安装生产内核，无全局 dsh/pnpm 的首次及重复启动、包内 68 列 TTY 帮助/退出/终端恢复全部通过。
- 独立只读代码审查：未发现新增 P1/P2 或阻塞性目标缺口；上述 binding 既有边界已明确记录，不计为本次修复覆盖。
- `git diff --check`：通过；五份消息 golden 预期、ui/terminal/ink/native-ts 源码未修改。

本次已完成实现复核、异常释放修复及当前源码重新验收。所有成果仍在 `feat/adapter-decoupling` 工作区，未提交、合并、推送或发布。原有解耦成果和本次新增计划/源码/专项中仍有未跟踪文件，提交时须显式纳入对应路径，不能只暂存已跟踪文件。临时 RED/GREEN、构建、专项、完整回归及打包日志保留在忽略的 `.local/adapter-decoupling-closeout/`。


## 分批提交与本地整合

2026-11-01 用户在收尾验收后明确要求分多个提交并合并。此前“不提交、不合并”的约定及验收时的工作区状态为历史记录，自本次授权起由以下整合方式替代：

1. 输入队列与图片能力抽取。
2. 设置模型目录、推理强度与配置就绪政策抽取。
3. 会话规划与交接用例。
4. 工作台命令路由。
5. 模块语义状态操作与历史行身份保护。
6. 输入发送接入模块 FIFO。
7. 任务及子代理展示投影。
8. 事件协调、模块命令生命周期与最终窄端口装配。
9. 独立的 reservation 异常释放修复及回归。
10. 架构说明、实施与验收文档。

拆分期间在临时目录检出暂存快照，逐笔执行构建和相关专项，确保每笔提交具备完整依赖。过渡提交保留当时的旧宿主接线，最终装配提交移除这些过渡入口；最终源码与本轮已验收源码保持一致。合并使用 fast-forward，保留全部提交，不 squash、不推送。合并后的 `main` 再执行构建和完整回归。暂存快照验证日志保留在忽略的 `.local/split-commits/`。
