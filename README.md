# dsh TUI Lite

**English** | [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](tsconfig.json)
[![Node.js](https://img.shields.io/badge/Node.js-%5E22.19%20%7C%7C%20%3E%3D24-339933?style=flat&logo=node.js&logoColor=white)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-F69220?style=flat&logo=pnpm&logoColor=white)](pnpm-lock.yaml)

A simple, lightweight, open-source terminal client focused on the TUI layer for DeepSeek Harness.

Derived from dsh-TUI, this version reworks the architecture, command handling, and internal structure, removes redundant logic, and keeps the essentials for everyday use. The goal is a small, practical terminal interface that is easy to maintain.

## What differs from dsh-TUI

The implementation has been reorganized around a simple, lightweight TUI layer:

| Area | Changes in this project |
| --- | --- |
| Architecture | Organize modules by feature, clarify UI, interaction, and dsh integration responsibilities, and remove duplicated state and redundant logic |
| Commands | Consolidate command entry points and handling, and simplify common operations |
| Internal consistency | Standardize module structure, public interfaces, and shared UI components for easier maintenance and extension |
| TUI focus | Handle input, presentation, and interaction through the existing dsh adapter/channel integration |

**Core principle: keep the TUI layer simple and lightweight.** Harness owns agents, models, tool execution, session persistence, and policies. The TUI provides the terminal interactions needed to use those capabilities, avoiding duplicate implementations and redundant logic.

Currently, this version keeps the basic functionality. Further improvements will follow practical needs while preserving clear responsibilities.

## Current features

| Feature | Description |
| --- | --- |
| Terminal chat | Interact with agents and view streaming responses and tool results |
| Model configuration | Configure providers and authentication, and select or switch models |
| Session management | Create, resume, rename, and export sessions |
| Context management | Compact earlier conversation turns to free context space |
| Approvals and questions | Respond to permission requests and questions during tool execution |

The chat uses the terminal's alternate screen with a fixed-height transcript viewport, so the composer stays pinned to the bottom while the conversation scrolls. Set `DSH_TUI_INLINE=1` to use the previous inline layout instead.

## Build and install locally

**This project has not been published to npm yet.** Build from source and install locally for now. An npm release is planned once the features and user experience are more complete.

Requires Node.js matching `^22.19 || >=24` and pnpm (the project uses `11.21.0`).

### 1. Get the source and build

```sh
git clone https://github.com/xqcherry/dsh-tui-lite.git
cd dsh-tui-lite
pnpm install --frozen-lockfile
pnpm build
```

The required DeepSeek Harness (dsh) version is installed with the project dependencies. A separate global dsh installation is not needed.

### 2. Install locally

From the repository root, run:

```sh
npm install -g .
```

This links the local project as a global command. Keep the source directory and build output, and ensure npm's global command directory is on your `PATH`. After updating the source, reinstall dependencies and run `pnpm build` in the repository to use the updated build.

### 3. Run

After installation, open a terminal in your working directory and run:

```sh
dsl
```

`dsh-tui-lite` is an equivalent full command.

The launcher uses a separate `~/.dsh/profiles/dsh-tui-lite` profile (under `DSH_HOME` when set). Harness manages sessions and credentials.

On first launch:

1. Run `/provider` to configure a provider and API details. Use `/auth` for account login when needed.
2. Run `/model` to select an available model.
3. Enter a task or question to start a conversation.

Run `/help` to see available commands and keyboard shortcuts.

## Common commands

| Command | Purpose |
| --- | --- |
| `/provider` | Configure providers and API endpoints |
| `/auth` | Manage provider login and authentication |
| `/model` | View or switch models |
| `/new` | Start a new conversation |
| `/resume` | Select and resume a saved session |
| `/rename <name>` | Rename the current session |
| `/export` | Export the current session |
| `/compact` | Compact earlier conversation turns |
| `/permission` | View or switch permission modes |
| `/status` | View the current session, model, and working directory |
| `/help` | Show help |
| `/exit` | Exit the client |

## Local development

After installing dependencies as described above, build and launch directly from the repository:

```sh
pnpm dev
```

`pnpm dev` builds the source and launches the client. You can also run these steps separately:

```sh
pnpm build
pnpm start
```

Edit source files in `src/`; `lib/` is generated. The UI connects to dsh through the adapter/channel integration. Harness provides agents, tool execution, and session persistence.

Before submitting changes, run:

```sh
pnpm build
pnpm verify
```

See the [architecture guide](docs/architecture.md) for the system design, data flow, and contribution entry points. [Repository rules](AGENTS.md) are available in Chinese.

## Roadmap

- Improve goal interactions and progress display in the terminal.
- Improve compact interactions and compaction status feedback.
- Add Vim mode for keyboard editing.
- Add btw and other common interactions based on practical feedback.
- Refine chat, tool result presentation, and session management.
- Expand usage, troubleshooting, and development documentation.

New features should serve terminal interaction needs, reuse existing dsh capabilities, and keep the implementation simple and lightweight.

## Contributing

Bug reports, suggestions, and pull requests are welcome.

Read the [contribution guide](CONTRIBUTING.md) before submitting. There are two core requirements:

1. **Use the issue templates.** Describe the problem or practical need clearly and concisely.
2. **Own your code and treat production with care.** AI-generated code is welcome only when you understand, review, and verify your changes. Careless AI-generated submissions are not welcome.

## License

Licensed under [MIT License](LICENSE). The upstream dsh-TUI MIT copyright and license notice, along with other third-party notices, are preserved in [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES).

## Acknowledgments

This project is a simplified, lightweight derivative of [ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI). Thanks to the original author and contributors for their open-source work.
