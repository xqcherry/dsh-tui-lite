# Repository rules

- Edit `src/`, never generated `lib/`. Use ESM TypeScript, `.js` relative imports,
  `import type`, two spaces, single quotes, and no semicolons. Avoid `any`.
- DeepSeek Harness owns agents, models, tools, sessions, persistence, and policy.
  Keep UI behavior behind the existing adapter and channel services.
- Persisted transcripts are the source of truth. Preserve event order, sequence
  anchors, and tool call IDs; do not invent optimistic assistant or tool facts.
- Keep vendor imports in adapters: `@deepseek-ai/*` belongs in `src/dsh-adapter/`.
  UI and shared domain code must not depend directly on vendor packages.
- Run `pnpm build` and focused checks for code changes; use `pnpm verify` for
  the supported regression suite. Check terminal-visible changes in a narrow TTY.
- Do not log credentials. Keep diagnostics off stdout while the TUI is active.
- Do not commit, push, tag, or publish unless requested. Stage explicit paths only.
