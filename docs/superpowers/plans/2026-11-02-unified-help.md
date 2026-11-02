# Unified Help Implementation Plan

> Execute inline with superpowers:executing-plans. The user approved the conversation plan and requested implementation. The user subsequently requested multiple commits and a local merge to main. Do not push.

**Goal:** Replace the clipped composer-owned help overlay with the same command panel used by other commands.

**Architecture:** Chat owns one menu state and keyboard route. Help only supplies category, command and shortcut menu items; the composer exposes an opening callback.

**Tech Stack:** ESM TypeScript, React, the existing terminal renderer and xterm headless verification.

## Requirements and review focus

- Delete HelpMenu and composer help state, height budgets and keyboard branches; retain unrelated overlays.
- Both `/help` and empty-input `?` open the shared CommandMenu, suspending the composer.
- Root categories: Commands and Keyboard shortcuts. Each submenu has Back; Esc closes completely.
- Read the current command registry on opening; hide skill entries. Selecting a command fills `/name ` without executing it.
- Preserve shortcut content and resolve configurable labels using the current keymap. Read-only entries ignore Enter without dismissing the menu.
- Preserve complete borders/title/footer and focused rows at 100/80/40/20 columns and on resizing to 12 rows.
- Verify opening Enter, typing, paste shortcuts and mode cycling cannot reach the suspended composer.

## Tasks

- [x] Replace the old standalone help test with real Chat/xterm interaction tests; observe the old clipped frame and missing category failure.
- [x] Add help menu content, optional menu actions and the shared Chat opening callback; remove the old help renderer and composer branches.
- [x] Update dependent fixtures and the real narrow PTY boot smoke for the shared menu.
- [x] Run build, targeted checks, full verify and narrow TTY smoke; review the complete diff.

## Validation

`pnpm build`; `node --import tsx/esm scripts/verify-workbench-commands.ts`; `node --import tsx/esm scripts/verify-help-panel.tsx`; `pnpm verify`; `git diff --check`.

Baseline: latest local main at 9b1741f; implementation branch fix/unified-help. The working tree was clean at execution start. Preserve the unrelated whale-frames.ts edit that appeared during execution.

## Results and review

- `pnpm build`: passed.
- Command routing and full Chat help regressions: passed, including repeated picks and 100x32, 80x24, 40x24, 40x12, 20x12 terminals.
- Real 68-column POSIX PTY: boot, `/help`, Commands submenu, Esc, `/exit`, terminal restoration passed.
- `pnpm verify`: 57/57 passed after the fixes; `git diff --check`: passed.
- Independent read-only review found stale repeated fill suppression in PromptInput. A new repeated-pick test failed before resetting the deduplication state on consumption and passed afterward.
- Deferred minor test gaps: live registry/keymap replacement and horizontal resizing were inspected in code, not separately simulated. Individual widths and active vertical resizing are covered.
- Integration authorized later: split the fill fix, unified help implementation, and PTY verification/documentation into separate commits, then merge locally into main and revalidate. Do not push. The external whale edit was left untouched and no longer appears in the help diff.
