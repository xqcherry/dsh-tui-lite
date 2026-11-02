# dsh TUI Lite

**English** | [简体中文](README.zh-CN.md)

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-green?style=flat)](LICENSE)
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

## Quick start

Requires Node.js matching `^22.19 || >=24` (Node.js 24 LTS is recommended). End users do not need pnpm or the source repository.

**DeepSeek Harness (dsh) must be installed before running the client.** Harness is a runtime dependency of this package. Installing the client with npm or a local `.tgz` package automatically installs the required Harness version; no separate global dsh installation is needed beforehand.

**Publication status: this project is not on npm yet.** The npm install and update commands below will work after `dsh-tui-lite` is published. The upstream package is a different project.

```sh
npm install -g dsh-tui-lite
```

After installation, open a terminal in your working directory and run:

```sh
dsl
```

`dsh-tui-lite` is an equivalent full command.

Update and uninstall (after publication):

```sh
npm install -g dsh-tui-lite@latest
npm uninstall -g dsh-tui-lite
```

The launcher uses a separate `~/.dsh/profiles/dsh-tui-lite` profile (under `DSH_HOME` when set) and leaves the upstream `dsh-tui` profile untouched. Harness still manages sessions and credentials; uninstalling the npm package does not delete that data.

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

Developers need pnpm. Install dependencies and launch from the project directory:

```sh
pnpm install --frozen-lockfile
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

Before npm publication, build a local installation package for users to install without compiling the source:

```sh
pnpm build
npm pack --ignore-scripts
npm install -g ./dsh-tui-lite-0.1.0.tgz
dsl
```

After a version change, use the actual filename printed by `npm pack`. Run `pnpm verify:package` to install the tarball into a temporary prefix and verify both commands.

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

Read the [contribution guide](CONTRIBUTING.md) (currently in Chinese) before submitting. There are two core requirements:

1. **Use the issue templates.** Describe the problem or practical need clearly and concisely.
2. **Own your code and treat production with care.** AI-generated code is welcome only when you understand, review, and verify your changes. Careless AI-generated submissions are not welcome.

## License

Licensed under [Apache License 2.0](LICENSE). The upstream dsh-TUI MIT copyright and license notice, along with other third-party notices, are preserved in [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES).

## Acknowledgments

This project is a simplified, lightweight derivative of [ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI). Thanks to the original author and contributors for their open-source work.
