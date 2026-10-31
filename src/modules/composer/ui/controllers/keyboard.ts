import type { DraftImageLease } from '../../model/image-tokens.js'
import type { StagedImageHandle } from '../../../../shared/protocol/composer.js'
import type { CommandCompletion } from '../../../../shared/protocol/commands.js'
import type { InputEvent, Key } from '../../../../ink/events/input-event.js'
import { isBigInput } from '../../model/geometry.js'


import { wordBoundaryLeft, wordBoundaryRight, graphemeBoundaries, previousGraphemeBoundary, nextGraphemeBoundary } from '../../model/editing.js'
import type { PromptHistoryEntry, DraftUndoEntry, UndoMode } from '../../model/editing.js'

import React from 'react'
import { unlink } from 'node:fs/promises'

import type { ComposerImageRef } from '../../../../shared/protocol/composer.js'
import { t } from '../../../../shared/i18n.js'
import type { ComposerPort as Channel } from '../../contracts.js'


import { formatClipboardInsert, readClipboard } from '../../../../shared/platform/clipboard.js'
import { editInExternalEditor } from '../../../../terminal/external-editor.js'
import { type FileCandidate } from '../../../../shared/platform/file-suggestions.js'
import { sanitizePastedText } from '../../../../shared/platform/inputPaste.js'

import { actionMatches } from '../../../../shared/platform/keymap.js'

import { isMod } from '../../../../shared/platform/modifiers.js'
import { imagePathMediaType, parsePastedImagePath, stageClipboardFilePaths } from '../../../../shared/platform/pastedImagePath.js'

import { type ScrollBoxHandle } from '../../../../terminal/index.js'


interface Context {
  readonly selectionActive: boolean
  readonly editorBusyRef: React.RefObject<boolean>
  readonly valueRef: React.RefObject<string>
  readonly cursorRef: React.RefObject<number>
  readonly selectionRef: React.RefObject<{ start: number; end: number; } | null>
  readonly consumeEditingEscape: () => boolean
  readonly deleteInputRange: (start: number, end: number, undo?: UndoMode) => void
  readonly setSelectedCommand: React.Dispatch<React.SetStateAction<number>>
  readonly setFileSelected: React.Dispatch<React.SetStateAction<number>>
  readonly foldBlockRef: React.RefObject<{ start: number; end: number; } | null>
  readonly updateFoldBlock: (block: { start: number; end: number; } | null) => void
  readonly setInput: (next: string, cursorOffset?: number, undo?: UndoMode, snapshotBlock?: DraftUndoEntry["block"]) => void
  readonly helpOpen: boolean
  readonly onToggleHelp: () => void
  readonly captureDraftImageLease: () => DraftImageLease
  readonly enqueueImageWork: <T>(work: () => Promise<T>) => Promise<T>
  readonly stageImagePath: (path: string, lease: DraftImageLease) => Promise<StagedImageHandle>
  readonly bindStagedImage: (handle: StagedImageHandle, lease: DraftImageLease) => string
  readonly insertClipboardAtCaret: (text: string) => { next: string; at: number; }
  readonly channel: Channel
  readonly stagedImageNotice: (token: string, handle: StagedImageHandle) => string
  readonly draftImageLeaseIsCurrent: (lease: DraftImageLease) => boolean
  readonly clipboardBusyRef: React.RefObject<boolean>
  readonly draftImagesRef: React.RefObject<Map<string, string>>
  readonly discardStagedHandles: (handles: readonly StagedImageHandle[]) => void
  readonly syncImageGeneration: () => number
  readonly advanceDraftRevision: () => void
  readonly handleEnter: () => void
  readonly chooseCommand: (text: string) => void
  readonly tryRunCommand: (text: string) => boolean
  readonly submitText: (text: string, notice?: string) => void
  readonly interruptSend: () => void
  readonly fileOverlayOpen: boolean
  readonly overlayOpen: boolean
  readonly fileMatches: readonly FileCandidate[]
  readonly fileSelected: number
  readonly acceptFile: (candidate: FileCandidate) => void
  readonly suggestions: readonly CommandCompletion[]
  readonly selectedCommand: number
  readonly queueSend: (text: string) => void
  readonly helpViewportHeight: number
  readonly helpScrollRef: React.RefObject<ScrollBoxHandle | null>
  readonly pullBackLast: () => void
  readonly dockSelectedRef: React.RefObject<number | null>
  readonly setDockSelected: (index: number | null) => void
  readonly dockCount: number
  readonly historyIndex: React.RefObject<number>
  readonly cursorLine: (text: string, cursorOffset: number) => number
  readonly tail: string
  readonly cursorColumn: (text: string, cursorOffset: number) => number
  readonly seedHistory: () => boolean
  readonly history: React.RefObject<PromptHistoryEntry[]>
  readonly restoreHistoryDraft: () => void
  readonly historyDraft: React.RefObject<PromptHistoryEntry>
  readonly imageRefsFor: (text: string) => ComposerImageRef[]
  readonly retractRecalledCopy: (text: string) => void
  readonly restoreDraftImages: (entry: PromptHistoryEntry) => void
  readonly head: string
  readonly undoDraft: () => void
  readonly clearDraftUndoably: () => void
  readonly fileEscRef: React.RefObject<number>
  readonly mention: { start: number; end: number; query: string; pathEnd?: number; } | undefined
}

export function createComposerKeyboard(getContext: () => Context) {
  return (input: string, key: Key, event: InputEvent) => {
const { selectionActive, editorBusyRef, valueRef, cursorRef, selectionRef, consumeEditingEscape, deleteInputRange, setSelectedCommand, setFileSelected, foldBlockRef, updateFoldBlock, setInput, helpOpen, onToggleHelp, captureDraftImageLease, enqueueImageWork, stageImagePath, bindStagedImage, insertClipboardAtCaret, channel, stagedImageNotice, draftImageLeaseIsCurrent, clipboardBusyRef, draftImagesRef, discardStagedHandles, syncImageGeneration, advanceDraftRevision, handleEnter, chooseCommand, tryRunCommand, submitText, interruptSend, fileOverlayOpen, overlayOpen, fileMatches, fileSelected, acceptFile, suggestions, selectedCommand, queueSend, helpViewportHeight, helpScrollRef, pullBackLast, dockSelectedRef, setDockSelected, dockCount, historyIndex, cursorLine, tail, cursorColumn, seedHistory, history, restoreHistoryDraft, historyDraft, imageRefsFor, retractRecalledCopy, restoreDraftImages, head, undoDraft, clearDraftUndoably, fileEscRef, mention } = getContext()

    if (selectionActive) return
    // The editor round-trip ends by resuming stdin one microtask before the
    // outcome lands — drop any key squeezed into that gap so the prompt's
    // setValue can never overwrite fresh typing (and vice versa).
    if (editorBusyRef.current) return

    // App deliberately dispatches every parsed key from one stdin read in a
    // single React update. Read the synchronous mirrors so each event sees
    // the text/caret produced by the preceding event in that batch.
    const value = valueRef.current
    const cursor = cursorRef.current
    const selection = selectionRef.current

    // ── mouse selection (drag / Shift+click / double-click) ─────────────
    // Layered ahead of the fold-block rules: with an active selection, Esc
    // ONLY drops the highlight (text untouched), and Backspace/Delete
    // delete the selected span. Arrows/typing handle the selection at their
    // own arms below.
    if (key.escape && consumeEditingEscape()) {
      event.stopImmediatePropagation()
      return
    }
    if ((key.backspace || key.delete) && selection) {
      // Removing a selection is atomic: it must undo in one step, not fold
      // into whatever the caret-continuity rule would otherwise see.
      deleteInputRange(selection.start, selection.end, 'step')
      setSelectedCommand(0)
      setFileSelected(0)
      return
    }

    // Fold block: Esc expands it — it must NEVER clear text
    // that LOOKS like one line; Backspace at the block's tail / Delete at
    // its head deletes the WHOLE block in one key; ←/→ jump over the
    // atomic block. Typing NEVER expands it — the caret lives outside the
    // block and edits land in the visible text around it.
    const block = foldBlockRef.current
    // Line-level moves/edits (↑/↓/Home/End/Ctrl+A/E/U/K/W) treat the
    // block as an atomic row: boundaries that would land inside it are
    // clamped to its edges.
    const clampRowStart = (pos: number) =>
      block && cursor >= block.end ? Math.max(pos, block.end) : pos
    const clampRowEnd = (pos: number) =>
      block && cursor <= block.start ? Math.min(pos, block.start) : pos
    if (block) {
      if (key.escape) {
        event.stopImmediatePropagation()
        updateFoldBlock(null)
        return
      }
      if ((key.backspace && cursor === block.end) || (key.delete && cursor === block.start)) {
        const next = value.slice(0, block.start) + value.slice(block.end)
        updateFoldBlock(null)
        setInput(next, block.start, 'step', block)
        setSelectedCommand(0)
        setFileSelected(0)
        return
      }
      if (key.leftArrow && cursor === block.end) {
        setInput(value, block.start)
        return
      }
      if (key.rightArrow && cursor === block.start) {
        setInput(value, block.end)
        return
      }
    }

    // Grapheme boundaries of the current text: every caret move / delete
    // below snaps onto one of these offsets (never mid-cluster).
    const bounds = graphemeBoundaries(value)

    /** Insert text at the caret (typing, paste) and dismiss overlays. An
     *  active selection is REPLACED by the insert (standard editor
     *  semantics). Returns the insertion offset so callers can derive the
     *  inserted span (paste fold). */
    const insertAtCaret = (text: string, undo: UndoMode = 'group'): number => {
      if (helpOpen) onToggleHelp()
      const sel = selectionRef.current
      const at = sel ? sel.start : cursor
      const next = sel
        ? value.slice(0, sel.start) + text + value.slice(sel.end)
        : value.slice(0, cursor) + text + value.slice(cursor)
      // Replacing a selection is atomic (like deleting one): the replaced span
      // must not fold into the surrounding typed run.
      setInput(next, at + text.length, sel ? 'step' : undo)
      setSelectedCommand(0)
      setFileSelected(0)
      return at
    }

    // Bracketed paste (terminal paste — Ctrl+Shift+V / right-click): insert
    // at the caret after removing terminal controls and expanding tabs.
    // Newlines remain data — they are NOT Enter — so this branch runs before
    // the whole-line submit rule.
    if (event?.isPasted && input.length > 0) {
      const text = sanitizePastedText(input.replace(/\r\n/g, '\n').replace(/\r/g, '\n'))
      // Desktop drops reach the TUI as pasted text (Ghostty forwards
      // Shell.escape(path) through the PTY with no drop boundary). Only a
      // paste that IS one unambiguous existing local image path stages as
      // an image; any parse/stat/staging failure inserts the text verbatim.
      const droppedPath = parsePastedImagePath(text)
      if (droppedPath !== null) {
        const lease = captureDraftImageLease()
        if (helpOpen) onToggleHelp()
        setSelectedCommand(0)
        setFileSelected(0)
        void enqueueImageWork(async () => {
          const handle = await stageImagePath(droppedPath, lease)
          const token = bindStagedImage(handle, lease)
          // Bind and insert share this synchronous continuation: setInput's
          // sidecar pruning can never observe a bound-but-not-visible token.
          insertClipboardAtCaret(`${token} `)
          channel.notify(stagedImageNotice(token, handle), { timeoutMs: 2500 })
        })
          .catch(() => {
            if (!draftImageLeaseIsCurrent(lease)) return
            // A real path/read/stage failure keeps the terminal paste as text.
            // A revoked lease is handled above and must not edit a newer draft.
            insertClipboardAtCaret(text)
          })
        return
      }
      // One paste is ONE undo step however many characters it carries.
      const at = insertAtCaret(text, 'step')
      // A big paste becomes a fold block right away (hover peeks
      // at it); an existing block is replaced by the new paste's span.
      if (isBigInput(text)) updateFoldBlock({ start: at, end: at + text.length })
      return
    }

    // Clipboard paste (default Ctrl+V / Cmd+V, plus the Alt+V alias for
    // terminals that intercept Ctrl+V — combos are user-remappable via
    // /settings): raw mode hands the key to the app, so the clipboard is
    // read here — text, file paths when the file manager copied files, or
    // an exported temp-file path when the clipboard holds a raw image.
    if (actionMatches('paste', input, key)) {
      if (clipboardBusyRef.current) return
      const lease = captureDraftImageLease()
      // Match insertAtCaret's overlay/selection dismissal up front: the
      // async continuation below only sets value/cursor, so a paste landing
      // while the help overlay is open would otherwise insert behind it.
      if (helpOpen) onToggleHelp()
      setSelectedCommand(0)
      setFileSelected(0)
      clipboardBusyRef.current = true
      void readClipboard()
        .then(async content => {
          // Every `kind: image` path is a private temp export owned by this
          // paste, including TIFF/BMP/SVG formats the attachment profile
          // cannot stage. Ownership must not depend on format support.
          const temporaryImagePath = content?.kind === 'image' ? content.path : undefined
          try {
            if (!draftImageLeaseIsCurrent(lease)) return
            if (content === null) {
              channel.notify(t('input-clipboard-empty'), { color: 'warning' })
              return
            }
            if (content.kind === 'unavailable') {
              channel.notify(t(content.wsl === true ? 'input-clipboard-unavailable-wsl' : 'input-clipboard-unavailable'), { color: 'warning' })
              return
            }
            if (content.kind === 'image') {
              if (imagePathMediaType(content.path) === undefined) {
                channel.notify(t('input-image-format-unsupported'), { color: 'warning', timeoutMs: 5000 })
                return
              }
              try {
                await enqueueImageWork(async () => {
                  const handle = await stageImagePath(content.path, lease)
                  const token = bindStagedImage(handle, lease)
                  insertClipboardAtCaret(`${token} `)
                  channel.notify(stagedImageNotice(token, handle), { timeoutMs: 2500 })
                })
              } catch (error: unknown) {
                if (!draftImageLeaseIsCurrent(lease)) return
                const message = error instanceof Error ? error.message : String(error)
                channel.notify(t('input-image-paste-failed', { err: message }), { color: 'warning', timeoutMs: 5000 })
              }
              return
            }
            if (content.kind === 'files') {
              // Finder/Explorer-copied image FILES stage like clipboard
              // bitmaps (macOS furl offers exactly one). Other files keep the
              // quoted/@ path insert, and an image that fails to stage falls
              // back to its `@` reference — the mention pipeline still
              // attaches it at submit.
              let insertedStaged = false
              try {
                insertedStaged = await enqueueImageWork(async () => {
                  const maxImages = channel.stagedImageLimits?.()?.maxImagesPerMessage ?? 0
                  const { parts, staged, failure, failureCode } = await stageClipboardFilePaths(
                    content.paths,
                    path => stageImagePath(path, lease),
                    filePath => formatClipboardInsert({ kind: 'files', paths: [filePath] }),
                    Math.max(0, maxImages - draftImagesRef.current.size),
                  )
                  if (!draftImageLeaseIsCurrent(lease)) {
                    discardStagedHandles(staged)
                    return true
                  }
                  const boundTokens: string[] = []
                  try {
                    const rendered = parts.map(part => {
                      if (part.kind === 'text') return part.value
                      const token = bindStagedImage(part.value, lease)
                      boundTokens.push(token)
                      return token
                    })
                    if (failure !== '') {
                      const message = failureCode === 'image-limit' ? t('input-image-paste-limit') : failure
                      channel.notify(t('input-image-paste-failed', { err: message }), { color: 'warning', timeoutMs: 5000 })
                    }
                    if (boundTokens.length === 0) return false
                    // All bindings and their visible labels enter together;
                    // typing while an earlier file saves cannot prune one.
                    insertClipboardAtCaret(`${rendered.join(' ')} `)
                    // A batch cannot itemise every image in one line, but it must
                    // still say that some of them were not stored as pasted.
                    const adapted = staged.filter(handle => handle.adjustment !== undefined).length
                    channel.notify(
                      boundTokens.length === 1
                        ? stagedImageNotice(boundTokens[0]!, staged[0]!)
                        : adapted > 0
                          ? t('input-images-staged-adapted', { count: boundTokens.length, adapted })
                          : t('input-images-staged', { count: boundTokens.length }),
                      { timeoutMs: 2500 },
                    )
                    return true
                  } catch (error) {
                    for (const token of boundTokens) draftImagesRef.current.delete(token)
                    discardStagedHandles(staged)
                    throw error
                  }
                })
              } catch (error: unknown) {
                if (!draftImageLeaseIsCurrent(lease)) return
                const message = error instanceof Error ? error.message : String(error)
                channel.notify(t('input-image-paste-failed', { err: message }), { color: 'warning', timeoutMs: 5000 })
              }
              if (insertedStaged) return
              // Nothing staged: fall through to the verbatim files insert.
            }
            if (!draftImageLeaseIsCurrent(lease)) return
            // Insert against the LIVE input state: the read above resolved
            // asynchronously and the user may have typed while waiting.
            const text = sanitizePastedText(formatClipboardInsert(content))
            const { at } = insertClipboardAtCaret(text)
            // Clipboard and bracketed paste share the same fold behavior.
            if (isBigInput(text)) updateFoldBlock({ start: at, end: at + text.length })
          } finally {
            // Clipboard bitmaps are private temp exports owned by this paste,
            // never durable attachment storage. Clean them on success,
            // rejection, draft invalidation, and session replacement alike.
            if (temporaryImagePath !== undefined) {
              await unlink(temporaryImagePath).catch(() => undefined)
            }
          }
        })
        .catch(() => {
          if (!draftImageLeaseIsCurrent(lease)) return
          channel.notify(t('input-clipboard-read-failed'), { color: 'warning' })
        })
        .finally(() => {
          // A rejected read must never wedge Ctrl+V for the rest of the
          // session.
          clipboardBusyRef.current = false
        })
      return
    }

    // Help is modal for modified keys and every Enter variant. The paste
    // branch above is the intentional exception: paste closes Help and
    // inserts visibly.
    // Swallow here before editor/submit/interrupt branches can mutate hidden
    // composer or working-turn state; plain typing still dismisses Help below.
    if (helpOpen && !key.escape && (key.ctrl || key.meta || key.super || key.return || input.includes('\n') || input.includes('\r'))) {
      event.stopImmediatePropagation()
      return
    }

    // Ctrl+G (remappable via /settings): edit the current draft in
    // $VISUAL/$EDITOR (issue #123, readline's edit-and-execute-command). The
    // draft is written to a temp file, the terminal is handed to the editor
    // (Ink's alt-screen handoff), and the saved text replaces the input when
    // it differs. The util maps every failure to an outcome, but the
    // catch/finally here is the hard guarantee: a rejected promise must
    // never kill the process, and the busy flag must always clear or the
    // editor key stays locked forever.
    if (actionMatches('editor', input, key)) {
      // Opening the editor starts a new async draft lifecycle immediately:
      // fence an older paste before the terminal handoff, but retain already
      // bound image capabilities. setInput below prunes only tokens the user
      // actually removed in the editor.
      syncImageGeneration()
      advanceDraftRevision()
      const editorLease = captureDraftImageLease()
      editorBusyRef.current = true
      void (async () => {
        try {
          const outcome = await editInExternalEditor(value)
          // Session switches, clears, history restores, and unmount all
          // revoke this editor round-trip. Never write its old draft into a
          // newer composer after the terminal handoff returns.
          if (!draftImageLeaseIsCurrent(editorLease)) return
          if (outcome.kind === 'edited') {
            // Snapshot the block BEFORE clearing it: the refill is one undo
            // step (D4), and Ctrl+Z must bring back the fold chip the draft
            // had, not the already-cleared null.
            const beforeBlock = foldBlockRef.current
            updateFoldBlock(null)
            setInput(outcome.text, outcome.text.length, 'step', beforeBlock)
            setSelectedCommand(0)
            setFileSelected(0)
          } else if (outcome.kind === 'unavailable') {
            channel.notify(t('input-editor-unavailable'), { color: 'warning' })
          } else if (outcome.kind === 'failed') {
            channel.notify(t('input-editor-failed', { name: outcome.message }), {
              color: 'warning',
            })
          }
        } catch {
          if (!draftImageLeaseIsCurrent(editorLease)) return
          channel.notify(t('input-editor-failed', { name: 'unknown' }), {
            color: 'warning',
          })
        } finally {
          editorBusyRef.current = false
        }
      })()
      return
    }

    // Ctrl+J is the portable multiline fallback when a terminal cannot
    // report modifiers on Enter. Legacy terminals deliver bare LF (`enter`),
    // while kitty/modifyOtherKeys encode it as an exact Ctrl+J key.
    const isCtrlJ = input === 'j' && key.ctrl && !key.shift && !key.meta && !key.super
    if ((input === '\n' && event?.keypress.name === 'enter') || isCtrlJ) {
      insertAtCaret('\n')
      return
    }

    // Whole-line input from Windows ConPTY pipelines (cmd batch -> node):
    // the trailing CR/LF marks a complete line to submit. A bare CR/CRLF is
    // Enter, while real multi-char piped lines keep the legacy direct-submit
    // path. Preserve its text in the draft before attempting delivery.
    if (input.includes('\n') || input.includes('\r')) {
      event.stopImmediatePropagation()
      if (/^[\r\n]+$/.test(input)) {
        handleEnter()
        return
      }
      const line = (value + input).trim()
      setInput(line, line.length)
      if (line.startsWith('/')) {
        const matches = channel.commandCompletions(line)
        if (matches.length === 1) {
          chooseCommand(matches[0]!.commandLine)
          return
        }
      }
      if (!tryRunCommand(line)) submitText(line)
      return
    }
    if (key.return && isMod(key)) {
      interruptSend()
      return
    }
    if (key.return && (key.shift || key.meta)) {
      // Shift+Enter / Option+Enter: insert a newline at the caret
      // (multi-line input). Shift+Enter only arrives when the terminal
      // supports extended key reporting (kitty/modifyOtherKeys allowlist in
      // ink/terminal.ts); Option+Enter (ESC CR) is the fallback on terminals
      // that can't report shift — e.g. macOS Terminal.app (issue #110).
      insertAtCaret('\n')
      return
    }
    if (key.return) {
      // A command may synchronously open a parent picker. Its opening Enter
      // belongs to the composer and must never also confirm that picker.
      event.stopImmediatePropagation()
      handleEnter()
      return
    }
    // Help is modal over the composer. Backtab must not cycle the session
    // mode invisibly behind it, and plain Tab has no Help action.
    if (helpOpen && key.tab) {
      event.stopImmediatePropagation()
      return
    }
    // Completion menus own Backtab just like plain Tab; do not mutate the
    // background session mode while the user is choosing a candidate.
    if (key.tab && key.shift && (fileOverlayOpen || overlayOpen)) {
      event.stopImmediatePropagation()
      return
    }
    // Shift+Tab cycles the configured session modes (default: 默认 →
    // 计划模式 → 完全访问; each mode bundles plan/sandbox/approval atoms —
    // see the `modes` config). Backtab is key.tab + key.shift.
    if (key.tab && key.shift) {
      // The key is consumed either way. `cycleMode` is best-effort inside the
      // channel, but a dropped rejection here would be an unhandledRejection
      // (the process guard rethrows everything that is not React #185), and
      // an unhandled rejection kills the TUI with the session still open —
      // so the caller keeps a catch of its own rather than `void`ing the
      // promise (the sibling `/permission` entry point does the same).
      void channel.cycleMode().catch((error: unknown) => {
        channel.notify(t('mode-switch-failed', { err: error instanceof Error ? error.message : String(error) }), {
          color: 'error',
          timeoutMs: 8000,
        })
      })
      return
    }
    if (key.tab && fileOverlayOpen) {
      const file = fileMatches[fileSelected]
      if (file) acceptFile(file)
      return
    }
    if (key.tab && overlayOpen) {
      const command = suggestions[selectedCommand]
      if (command) {
        updateFoldBlock(null)
        setInput(command.replacement, command.replacement.length, 'step')
      }
      return
    }
    // Tab while the model is working = queue for AFTER the turn (followup),
    // distinct from Enter's steer (Codex's "tab to queue message").
    if (key.tab && channel.working && value.trim() !== '') {
      queueSend(value)
      return
    }
    // Help is a viewport, not prompt history. It deliberately owns every
    // vertical navigation event while visible; otherwise Up/Down silently
    // walk the input history and the clipped command rows remain unreachable.
    if (helpOpen) {
      const page = Math.max(1, helpViewportHeight - 2)
      if (key.upArrow || key.wheelUp) {
        helpScrollRef.current?.scrollBy(key.wheelUp ? -3 : -1)
        event.stopImmediatePropagation()
        return
      }
      if (key.downArrow || key.wheelDown) {
        helpScrollRef.current?.scrollBy(key.wheelDown ? 3 : 1)
        event.stopImmediatePropagation()
        return
      }
      if (key.pageUp || key.pageDown) {
        helpScrollRef.current?.scrollBy(key.pageUp ? -page : page)
        event.stopImmediatePropagation()
        return
      }
      if (key.home) {
        helpScrollRef.current?.scrollTo(0)
        event.stopImmediatePropagation()
        return
      }
      if (key.end) {
        // Use a deliberately oversized absolute target rather than the
        // sticky-bottom path: compact Help may still be measuring nested
        // sections in this commit, while ScrollBox's render clamp resolves
        // the target to the exact current maximum without a follow-up frame.
        helpScrollRef.current?.scrollTo(Number.MAX_SAFE_INTEGER)
        event.stopImmediatePropagation()
        return
      }
    }
    if (key.meta && key.upArrow) {
      // Alt+Up: pull the last pending message back for editing (pi/Codex).
      pullBackLast()
      return
    }
    if (key.upArrow) {
      // The docked-queue selector owns ↑ while a row is highlighted
      // (Claude Code parity: "Press up to select a queued message to
      // edit"); the walk wraps around the dock. The REF drives it: one
      // stdin read can carry several ↑ (key repeat / a coalescing
      // terminal), and the state value would pin every handler in the
      // batch to the same row — N presses collapsing to one step.
      if (dockSelectedRef.current !== null) {
        const current = dockSelectedRef.current
        setDockSelected(current <= 0 ? dockCount - 1 : current - 1)
        return
      }
      // A history walk owns the arrows until it returns to the draft: a
      // recalled entry can itself open the @ menu or the slash menu (e.g.
      // `/model`), and letting the overlay navigate here strands the stashed
      // draft — Down would cycle menu rows instead of walking back.
      if (fileOverlayOpen && historyIndex.current < 0) {
        setFileSelected(index =>
          index <= 0 ? fileMatches.length - 1 : index - 1,
        )
        return
      }
      // With a fold block the caret in the tail walks the TAIL's lines
      // (the block is one atomic row); the first tail line steps over the
      // block to its head.
      if (block && cursor >= block.end) {
        const tailCursor = cursor - block.end
        const line = cursorLine(tail, tailCursor)
        if (line > 0) {
          const upToLineStart = tail.lastIndexOf('\n', tailCursor - 1)
          const prevLineStart =
            upToLineStart === -1 ? 0 : tail.lastIndexOf('\n', upToLineStart - 1) + 1
          const prevLine = tail.slice(prevLineStart, upToLineStart)
          setInput(
            value,
            block.end + prevLineStart + Math.min(cursorColumn(tail, tailCursor), prevLine.length),
          )
          return
        }
        setInput(value, block.start)
        return
      }
      const line = cursorLine(value, cursor)
      if (line > 0) {
        // Move to the previous line, clamping to its length.
        const upToLineStart = value.lastIndexOf('\n', cursor - 1)
        const prevLineStart =
          upToLineStart === -1 ? 0 : value.lastIndexOf('\n', upToLineStart - 1) + 1
        const prevLine = value.slice(prevLineStart, upToLineStart)
        setInput(value, prevLineStart + Math.min(cursorColumn(value, cursor), prevLine.length))
        return
      }
      if (overlayOpen && historyIndex.current < 0) {
        setSelectedCommand(index =>
          index <= 0 ? suggestions.length - 1 : index - 1,
        )
        return
      }
      // An EMPTY draft while idle with a docked queue takes ↑ into the dock
      // selector, ahead of the history walk (Claude Code parity). Any draft
      // keeps ↑ as cursor movement; the menus above keep their priority.
      if (
        value === '' && !channel.working
        && !overlayOpen && !fileOverlayOpen && dockCount > 0
      ) {
        setDockSelected(dockCount - 1)
        return
      }
      // A workspace switch mid-walk keeps the draft that walk started from:
      // the composer shows the previous project's entry, not a new draft.
      const interrupted = seedHistory()
      if (history.current.length === 0) {
        if (interrupted) restoreHistoryDraft()
        return
      }
      if (interrupted) {
        historyIndex.current = history.current.length - 1
      } else if (historyIndex.current < 0) {
        historyDraft.current = {
          text: value,
          images: imageRefsFor(value),
        }
        historyIndex.current = history.current.length - 1
      } else {
        historyIndex.current = Math.max(0, historyIndex.current - 1)
      }
      const entry = history.current[historyIndex.current]
      if (entry === undefined) return
      retractRecalledCopy(entry.text)
      updateFoldBlock(null)
      restoreDraftImages(entry)
      setInput(entry.text, entry.text.length, 'silent')
      return
    }
    if (key.downArrow) {
      // The docked-queue selector owns ↓ too (wraps down around the dock;
      // the REF, so a batch of ↓ advances one row per press — see ↑).
      if (dockSelectedRef.current !== null) {
        const current = dockSelectedRef.current
        setDockSelected(current >= dockCount - 1 ? 0 : current + 1)
        return
      }
      // Same history-walk ownership as ↑ above.
      if (fileOverlayOpen && historyIndex.current < 0) {
        setFileSelected(index =>
          index >= fileMatches.length - 1 ? 0 : index + 1,
        )
        return
      }
      // Mirror of the tail-side ↑ walk: with a fold block the caret walks
      // the TAIL's lines; past its last line it falls through to the
      // overlay/history handling below.
      if (block && cursor >= block.end) {
        const tailCursor = cursor - block.end
        const line = cursorLine(tail, tailCursor)
        const lines = tail.split('\n')
        if (line < lines.length - 1) {
          const nextLineStart = tail.indexOf('\n', tailCursor) + 1
          const nextLineEnd = tail.indexOf('\n', nextLineStart)
          const nextLine = tail.slice(
            nextLineStart,
            nextLineEnd === -1 ? tail.length : nextLineEnd,
          )
          setInput(
            value,
            block.end + nextLineStart + Math.min(cursorColumn(tail, tailCursor), nextLine.length),
          )
          return
        }
      } else if (block && cursor <= block.start) {
        // Head side: walk the HEAD's lines; its last line steps over the
        // block to the tail (never into history for a multi-row input).
        const line = cursorLine(head, cursor)
        const lines = head.split('\n')
        if (line < lines.length - 1) {
          const nextLineStart = head.indexOf('\n', cursor) + 1
          const nextLineEnd = head.indexOf('\n', nextLineStart)
          const nextLine = head.slice(
            nextLineStart,
            nextLineEnd === -1 ? head.length : nextLineEnd,
          )
          setInput(
            value,
            nextLineStart + Math.min(cursorColumn(head, cursor), nextLine.length),
          )
          return
        }
        setInput(value, block.end)
        return
      }
      const line = cursorLine(value, cursor)
      const lines = value.split('\n')
      if (line < lines.length - 1) {
        const nextLineStart = value.indexOf('\n', cursor) + 1
        const nextLineEnd = value.indexOf('\n', nextLineStart)
        const nextLine = value.slice(
          nextLineStart,
          nextLineEnd === -1 ? value.length : nextLineEnd,
        )
        setInput(value, nextLineStart + Math.min(cursorColumn(value, cursor), nextLine.length))
        return
      }
      if (overlayOpen && historyIndex.current < 0) {
        setSelectedCommand(index =>
          index >= suggestions.length - 1 ? 0 : index + 1,
        )
        return
      }
      // A walk cut short by a workspace switch has no position in the new
      // project's list; ↓ just ends it and returns the draft.
      if (seedHistory()) {
        restoreHistoryDraft()
        return
      }
      if (historyIndex.current < 0) return
      if (historyIndex.current >= history.current.length - 1) {
        restoreHistoryDraft()
      } else {
        historyIndex.current += 1
        const entry = history.current[historyIndex.current]
        if (entry !== undefined) {
          restoreDraftImages(entry)
          setInput(entry.text, entry.text.length, 'silent')
        }
      }
      return
    }
    if (isMod(key) && key.leftArrow) {
      // Jump to the previous word boundary (readline alt+b). Must precede the
      // bare-arrow arms: Ctrl+Left arrives as leftArrow + ctrl. An active
      // selection collapses to its START edge first (editor semantics).
      const sel = selectionRef.current
      setInput(value, sel ? sel.start : wordBoundaryLeft(value, cursor))
      return
    }
    if (isMod(key) && key.rightArrow) {
      // Jump to the next word boundary (readline alt+f).
      const sel = selectionRef.current
      setInput(value, sel ? sel.end : wordBoundaryRight(value, cursor))
      return
    }
    if (key.leftArrow) {
      // A selection collapses to its start edge before the caret moves.
      const sel = selectionRef.current
      setInput(value, sel ? sel.start : previousGraphemeBoundary(bounds, cursor))
      return
    }
    if (key.rightArrow) {
      const sel = selectionRef.current
      setInput(value, sel ? sel.end : nextGraphemeBoundary(bounds, cursor))
      return
    }
    if (key.backspace) {
      if (cursor === 0) return
      const start = previousGraphemeBoundary(bounds, cursor)
      deleteInputRange(start, cursor)
      return
    }
    if (key.delete) {
      const end = nextGraphemeBoundary(bounds, cursor)
      if (end === cursor) return
      deleteInputRange(cursor, end)
      return
    }
    if (key.home) {
      // Start of the current line (the block is one atomic row).
      const lineStart = clampRowStart(value.lastIndexOf('\n', cursor - 1) + 1)
      setInput(value, lineStart)
      return
    }
    if (key.end) {
      // End of the current line.
      const nextLine = value.indexOf('\n', cursor)
      setInput(value, nextLine === -1 ? value.length : clampRowEnd(nextLine))
      return
    }
    if (isMod(key) && input === 'a') {
      const lineStart = clampRowStart(value.lastIndexOf('\n', cursor - 1) + 1)
      setInput(value, lineStart)
      return
    }
    if (isMod(key) && input === 'e') {
      const nextLine = value.indexOf('\n', cursor)
      setInput(value, nextLine === -1 ? value.length : clampRowEnd(nextLine))
      return
    }
    if (isMod(key) && input === 'u') {
      // Delete to start of line (never into the block).
      const lineStart = clampRowStart(value.lastIndexOf('\n', cursor - 1) + 1)
      deleteInputRange(lineStart, cursor)
      return
    }
    if (isMod(key) && input === 'k') {
      // Delete to end of line (never into the block).
      const nextLine = value.indexOf('\n', cursor)
      const end = nextLine === -1 ? value.length : clampRowEnd(nextLine)
      deleteInputRange(cursor, end)
      return
    }
    if (actionMatches('undo', input, key)) {
      // Word-level draft undo (remappable via /settings). Only the prompt
      // draft has an undo space: with the keyboard owned by a panel or a
      // dialog this handler is inactive (useInput isActive), and an empty
      // stack is a no-op rather than the rewind picker.
      undoDraft()
      return
    }
    if (isMod(key) && input === 'w') {
      // Delete the word before the cursor: readline's whitespace-delimited
      // rule (skip trailing whitespace, then the word). The ICU/CJK
      // alternative is a separate editor-UX change, not part of draft undo.
      // The deletion start never crosses into the block.
      const before = value.slice(0, cursor)
      let end = before.length
      while (end > 0 && /\s/.test(before[end - 1]!)) end--
      let start = end
      while (start > 0 && !/\s/.test(before[start - 1]!)) start--
      deleteInputRange(clampRowStart(start), cursor)
      return
    }
    if (key.escape) {
      if (helpOpen) {
        event.stopImmediatePropagation()
        onToggleHelp()
        return
      }
      // A single Esc closes the open command menu first;
      // the double-tap-clear semantics only apply to ordinary input.
      if (overlayOpen) {
        event.stopImmediatePropagation()
        clearDraftUndoably()
        return
      }
      // File overlay: Esc dismisses the menu for THIS token only — clearing
      // the input would nuke a mid-message `@` mention's surrounding text.
      if (fileOverlayOpen) {
        event.stopImmediatePropagation()
        fileEscRef.current = mention?.start ?? -1
        return
      }
      // The docked-queue selector folds before anything else: Esc leaves the
      // selector (Chat's delegation reaches this through consumeEscape too).
      if (dockSelectedRef.current !== null) {
        setDockSelected(null)
        return
      }
      // With pending messages while working, Esc = interrupt and DOCK the
      // queue (Claude Code parity): the previews park channel-side and the
      // dock hint offers ↑ to edit one / ⏎ to send them all — nothing
      // auto-sends. A queue already fully docked docks nothing new; the
      // turn still needs its plain abort.
      if (channel.working && channel.pending.length > 0) {
        event.stopImmediatePropagation()
        if (channel.interruptAndDock() === 0) channel.cancel()
        return
      }
      // Chat owns a plain working-turn interrupt. Preserve the draft.
      if (channel.working) return
      event.stopImmediatePropagation()
      // A single Esc clears the current input (if any); the double-tap
      // path below handles rewind/clear on an already-empty input. A BIG
      // input folds into a block instead (Esc = the fold toggle; the
      // expand → fold → expand cycle is lossless, and clearing a big draft
      // stays reachable via the block-delete Backspace or Ctrl+C).
      if (value.length > 0) {
        if (isBigInput(value)) {
          updateFoldBlock({ start: 0, end: value.length })
          setSelectedCommand(0)
          setFileSelected(0)
          return
        }
        // Esc clearing the draft is undoable (D4): Ctrl+Z brings the whole
        // draft back, images and fold block included.
        clearDraftUndoably()
        return
      }
      return
    }
    if (input === '?' && value.length === 0) {
      onToggleHelp()
      return
    }
    if (input && !key.ctrl && !key.meta && !key.super && !key.tab && !key.escape) {
      // Typing anything else dismisses the help menu…
      if (helpOpen) onToggleHelp()
      // …and leaves the docked-queue selector: the draft is no longer empty,
      // so ↑ goes back to cursor movement.
      if (dockSelectedRef.current !== null) setDockSelected(null)
      // An active selection is REPLACED by the typed text, caret after it.
      const sel = selectionRef.current
      const at = sel ? sel.start : cursor
      const next = sel
        ? value.slice(0, sel.start) + input + value.slice(sel.end)
        : value.slice(0, cursor) + input + value.slice(cursor)
      // Replacing a selection is atomic, exactly like `insertAtCaret`: the
      // replaced span must not fold into the surrounding typed run.
      setInput(next, at + input.length, sel ? 'step' : 'group')
      setSelectedCommand(0)
      setFileSelected(0)
    }
  }
}
