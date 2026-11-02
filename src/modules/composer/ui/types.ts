


import React from 'react'

import type { ComposerImageRef } from '../../../shared/protocol/composer.js'
import type { ComposerBinding } from '../contracts.js'
import type { SessionsSnapshot } from '../../sessions/contracts.js'
import type { SettingsSnapshot } from '../../settings/contracts.js'
import type { Notify } from '../../../shared/protocol/notifications.js'
import type { LocalCommand } from '../../../shared/protocol/commands.js'
import type { ReadableStore } from '../../../shared/state/module-store.js'
import type { NotificationItem } from '../../../shared/protocol/session.js'

/** Cross-module reads and the two explicit actions the input requires. */
export interface ComposerContext {
  readonly sessions: ReadableStore<SessionsSnapshot>
  readonly settings: ReadableStore<SettingsSnapshot>
  readonly workbench: ReadableStore<{ readonly notifications: readonly NotificationItem[]; readonly commandList: readonly LocalCommand[] }>
  readonly notify: Notify
  readonly cycleMode: () => Promise<void>
}


import { type PromptDraftCache } from '../model/promptDraftCache.js'
export interface PromptController {
  hasText(): boolean
  /** The draft text, for a caller that must not lose it (see {@link PromptDraftCache}). */
  text(): string
  clear(): void
  /**
   * Append `text` at the end of the input (external injection channel; see
   * dsh-adapter/inject-channel.ts). Unlike `fillText`, which replaces the
   * whole value, this accumulates — matching OpenCode's `tui.prompt.append`
   * so repeated editor sends build one prompt. Returns the resulting value.
   */
  append(text: string): string
  /**
   * Copy the active mouse selection to the system clipboard (OSC 52 + the
   * native fallback) and KEEP the selection for further editing. Returns
   * true when a selection existed and consumed the key; Chat's Ctrl+C
   * branch calls this first, before its clear/exit semantics.
   */
  consumeSelectionCopy(): boolean
  /** Consume selection/editor Esc before Chat's working-turn interrupt. */
  consumeEscape(): boolean
}

export interface PromptInputProps {
  composer: ComposerBinding
  context: ComposerContext
  /** Keep the draft mounted while another prompt-slot panel owns the UI. */
  suspended?: boolean
  /**
   * Host judgement "this notice needs no toast" — the pet panel says it with
   * its speech bubble instead while it is the active panel. Evaluated during
   * render (not via an effect-written ledger) so toast and bubble swap in
   * the same commit without a one-frame flash. Errors are never suppressed.
   */
  toastSuppressed?: (item: NotificationItem) => boolean
  /**
   * Owner-held slot for the unsent draft.
   *
   * The prompt owns its text in local state, and several screens REPLACE the
   * conversation (the session screen, the session tree, settings, the jobs and
   * subagent panels, the trajectory scene) — early returns that unmount this
   * component and would take a half-written prompt down with it. Chat owns the
   * slot, so the text, its caret AND its image bindings survive that unmount
   * and come back when the composer does. The owner also drops it on a session
   * change, so a draft can never leak into a different conversation.
   *
   * Nothing is written from render: a commit-time assignment would run before
   * the restore effect has read the slot and overwrite the draft with the
   * empty first value.
   */
  draftCache?: PromptDraftCache
  /** Open the same Chat command menu as `/help`. */
  onOpenHelp(): void
  /**
   * Execute a slash command (built-in or plugin-registered) with its raw
   * argument text; returns false when the input should be sent to the model.
   */
  /** Refuse a model send before history, draft, images or queue are changed. */
  beforeSubmit?(): boolean
  onRunCommand(
    name: string,
    rawInput: string,
    images: readonly ComposerImageRef[],
  ): boolean | Promise<boolean>
  /**
   * Floating command list above the prompt instead of an in-flow list below
   * it. Fullscreen uses this so opening `/` completion never consumes layout
   * rows and never moves the composer; inline keeps the historical below-input
   * placement (short sessions can have no space above the prompt).
   */
  suggestionsAbove?: boolean
  /** Message-selection mode (Shift+↑): the input ignores keys while active. */
  selectionActive: boolean
  /**
   * External fill from history or help: when this prop changes to
   * a non-null string, the input replaces its value and moves the caret to
   * the end. The caller clears it via onFillConsumed once consumed.
   */
  fillText?: string | null
  onFillConsumed?(): void
  /**
   * Open the session screen (the one `/resume`, `/agentview` and `/home`
   * share) from the `⌂` entry at the head of the input row.
   *
   * Optional on purpose: the entry is rendered ONLY when this is provided, so
   * hosts that mount the prompt without a session screen — and the layout
   * regressions that pin this row's column budget — keep exactly the row they
   * had before.
   */
  onOpenSessions?(): void
  /** Filled with the live controller each render (see PromptController). */
  controllerRef?: React.RefObject<PromptController | null>
  /**
   * Clock seam for the draft undo's 700ms idle coalescing. Defaults to
   * `Date.now`; the regression harness passes a hand-advanced clock so the idle
   * rule is exercised without a wall-clock sleep (which would be flaky).
   */
  now?: () => number
}
