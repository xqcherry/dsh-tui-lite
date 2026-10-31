# dsh TUI

A terminal client for DeepSeek Harness, loaded as a dsh plugin. The npm package
includes a pinned dsh runtime: install once, then open the client directly.

## Install and run

Use Node.js 22.19 or 24+:

```sh
npm install -g @deepseek-harness-tui/dsh-tui
dsh-tui
```

A separate global dsh or pnpm installation is unnecessary. The first launch
initializes the dedicated `dsh-tui` profile and links it to the installed client;
subsequent launches use the same package without downloading another copy.
Run from your project directory, or use `dsh-tui /path/to/project`.
Configure a model with `/provider`, `/auth` or
`/model`, then write a prompt. Reference files with `@` and paste images.

Use `/new`, `/resume`, `/rename`, `/export` and `/compact` to manage conversations.
The client displays streaming output and tool results and handles approvals and
questions. `dsh-tui --resume <session-id>` resumes a saved conversation; a bare
`--resume` uses the last session marker. `/help` lists commands; `/exit` exits.

Upgrade the client and its tested runtime together:

```sh
npm install -g @deepseek-harness-tui/dsh-tui@latest
```

Profile configuration lives in `$DSH_HOME/profiles/dsh-tui` (default
`~/.dsh/profiles/dsh-tui`). User profile patches are preserved and apply after
bundle defaults. Client preferences and resume markers retain their existing
`~/.dsh-tui` paths; transcripts remain owned by dsh persistence. If a legacy
profile contains a physical client package, the launcher retains it as a named
backup before linking the current installation. Other installed plugins remain.

## Development

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm verify
```

Edit `src/`; `lib/` is generated. Tests include real kernel startup in a narrow
POSIX PTY; these checks require Python 3 on macOS/Linux. Windows input protocol
checks run independently. Packaging runs the build automatically:

```sh
pnpm pack --pack-destination /tmp
pnpm verify:package
```

See [architecture](docs/architecture.md), [upstream upgrade procedure](docs/upstream-upgrades.md),
and [repository rules](AGENTS.md).

[MIT license](LICENSE). Third-party notices: [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES).
