# dsh-TUI

An inline terminal UI for DeepSeek Harness. The host owns agents, models,
tools, sessions, and persistence; this plugin provides the chat interface.

## Install and run

Use Node.js 22.19 or 24+ and pnpm.

```sh
npm install -g @deepseek-ai/dsh @deepseek-harness-tui/dsh-tui
dsh-tui
```

Configure providers and credentials inside the TUI with `/provider` and `/auth`,
then choose a model with `/model`.

## Chat

- Write prompts, reference files with `@`, and send images.
- Read streaming responses and tool results; answer approval requests and questions.
- Start, resume, rename, export, and compact sessions with `/new`, `/resume`,
  `/rename`, `/export`, and `/compact`.
- Adjust reasoning effort and permissions from the TUI.

## Development

Install and build:

```sh
git clone https://github.com/ccch1mneyyy/dsh-TUI.git
cd dsh-TUI
pnpm install --frozen-lockfile
pnpm build
pnpm verify
```

Edit `src/`; `lib/` is generated. See [AGENTS.md](AGENTS.md) for repository rules.

[MIT license](LICENSE). Third-party notices: [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES).
