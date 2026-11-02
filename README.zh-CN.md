# dsh TUI Lite

[English](README.md) | **简体中文**

[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](tsconfig.json)
[![Node.js](https://img.shields.io/badge/Node.js-%5E22.19%20%7C%7C%20%3E%3D24-339933?style=flat&logo=node.js&logoColor=white)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-F69220?style=flat&logo=pnpm&logoColor=white)](pnpm-lock.yaml)

一个简洁、轻量的开源 dsh 终端客户端，专注于做好 DeepSeek Harness 的 TUI 层。

基于 dsh-TUI 二次开发，对架构、命令和内部实现做了重新整理，删除冗余逻辑，保留日常使用所需的基础能力。目标是提供一个小巧、顺手、易维护的终端界面。

## 与 dsh-TUI 的区别

这个版本围绕“简单、轻量的 TUI 层”重新梳理了实现，主要调整了以下几个方面：

| 方向 | 本项目的调整 |
| --- | --- |
| 架构重构 | 按功能重新划分模块，明确界面、交互逻辑与 dsh 接入的职责，清理重复状态和冗余逻辑 |
| 命令整理 | 集中梳理命令入口与处理流程，精简常用操作，让命令组织更清晰 |
| 内部风格统一 | 统一模块结构、公开接口与界面基础组件，减少分散实现，方便维护和扩展 |
| 专注 TUI | 聚焦输入、展示与交互，通过现有 adapter/channel 接入 dsh 的能力 |

**核心原则：只做好简单、轻量的 TUI 层。** agent、模型、工具执行、会话持久化与策略交给 Harness；TUI 围绕这些能力提供必要的终端交互，避免重复实现和冗余逻辑。

目前仅保留基本功能，后续会根据实际需求持续补充功能、打磨体验，并保持清晰的职责边界。

## 目前能做什么

| 功能 | 说明 |
| --- | --- |
| 终端对话 | 在终端中与 agent 交互，查看流式回复和工具执行结果 |
| 模型配置 | 配置服务商、认证信息，选择和切换模型 |
| 会话管理 | 新建、恢复、重命名与导出会话 |
| 上下文管理 | 压缩较早的对话内容，释放上下文空间 |
| 交互确认 | 处理工具执行中的权限确认与提问 |

对话界面使用终端的 alternate screen 和固定高度的转录视口，转录区内部滚动，输入框始终固定在底部。需要回到原来的 inline 布局时，设置 `DSH_TUI_INLINE=1`。

## 本地构建与安装

**本项目目前尚未发布到 npm。** 现阶段请从源码构建并在本地安装；后续功能与体验完善后会发包。

需要 Node.js（版本满足 `^22.19 || >=24`）和 pnpm（项目使用 `11.21.0`）。

### 1. 获取源码并构建

```sh
git clone https://github.com/xqcherry/dsh-tui-lite.git
cd dsh-tui-lite
pnpm install --frozen-lockfile
pnpm build
```

所需版本的 DeepSeek Harness（dsh）会随项目依赖一起安装，无需单独安装全局 dsh。

### 2. 本地安装

在仓库根目录执行：

```sh
npm install -g .
```

此命令将本地项目链接为全局命令。请保留源码目录和构建产物，并确保 npm 的全局命令目录已加入 `PATH`。更新源码后，在仓库目录重新安装依赖并执行 `pnpm build` 即可使用新的构建。

### 3. 运行

安装后，在你希望使用的工作目录打开终端，运行：

```sh
dsl
```

`dsh-tui-lite` 是同等功能的完整命令。

启动器使用独立的 `~/.dsh/profiles/dsh-tui-lite` profile（设置 `DSH_HOME` 时跟随该目录）。会话和认证由 Harness 管理。

首次使用：

1. 输入 `/provider` 配置服务商与 API 信息；需要账户登录时使用 `/auth`。
2. 输入 `/model` 选择可用模型。
3. 输入你的任务或问题，开始对话。

输入 `/help` 查看可用命令与快捷键。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `/provider` | 配置服务商与 API 地址 |
| `/auth` | 管理服务商登录与认证 |
| `/model` | 查看或切换模型 |
| `/new` | 开始新对话 |
| `/resume` | 选择并恢复已保存的会话 |
| `/rename <名称>` | 重命名当前会话 |
| `/export` | 导出当前会话 |
| `/compact` | 压缩较早的对话内容 |
| `/permission` | 查看或切换权限模式 |
| `/status` | 查看当前会话、模型与工作目录信息 |
| `/help` | 查看帮助 |
| `/exit` | 退出客户端 |

## 本地开发

完成上述依赖安装后，可在仓库目录直接构建并启动：

```sh
pnpm dev
```

`pnpm dev` 会先构建源码，再启动客户端。也可以分别执行：

```sh
pnpm build
pnpm start
```

源码位于 `src/`，`lib/` 为构建产物。界面通过 adapter/channel 接入 dsh，agent、工具执行和会话持久化由 Harness 提供。

提交改动前运行：

```sh
pnpm build
pnpm verify
```

更多说明见 [项目架构](docs/architecture.zh-CN.md) 和 [开发规范](AGENTS.md)。

## 后续方向

- 优化 goal 的终端交互与目标进度展示。
- 优化 compact 的操作体验与压缩状态反馈。
- 加入 Vim 模式，完善键盘编辑体验。
- 加入 btw 等常用交互功能，并根据实际使用反馈逐步完善。
- 持续完善对话、工具结果展示和会话管理体验。
- 完善使用文档、问题排查说明与开发指引。

新增功能以终端交互需求为出发点，优先复用 dsh 已有能力，持续清理重复实现，保持简单、轻量。

## 参与贡献

欢迎通过 Issue 反馈问题、提出建议，也欢迎提交 PR。

提交前请阅读 [贡献指南](CONTRIBUTING.md)，核心要求只有两条：

1. **按模板提交 Issue。** 说明问题或实际需求，保持简短、具体。
2. **对自己的代码负责，敬畏生产。** 允许 AIGC，但必须理解、审查并验证自己的改动，不欢迎粗制滥造的 AI 代码提交。

## 许可证

本项目采用 [MIT License](LICENSE)。上游 dsh-TUI 的 MIT 版权与许可声明，以及其他第三方许可，保留在 [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES) 中。

## 致谢

本项目基于 [ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 二次开发，是在原项目基础上精简而来的轻量版本。感谢原作者及贡献者的开源工作。
