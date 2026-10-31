import type { PromptController, PromptInputProps } from './types.js'
export type { PromptController, PromptInputProps } from './types.js'

import { createComposerKeyboard } from './controllers/keyboard.js'
import { useComposerView } from './ComposerView.js'
import { createDraftUndo } from './controllers/draft-undo.js'
import { createImageOwnership } from './controllers/image-ownership.js'
import { createSubmission } from './controllers/submission.js'
import { createHistoryNavigation } from './controllers/history-navigation.js'
import { createAttachments } from './controllers/attachments.js'
import { createDraftEditing } from './controllers/draft-editing.js'


import { normalizeCursorOffset } from '../model/editing.js'
import type { PromptHistoryEntry, DraftUndoEntry } from '../model/editing.js'
import { composerImageRefsForText } from '../model/image-tokens.js'

import React from 'react'
// 粘贴/清洗语义已抽到 utils/inputPaste.ts（方案 B：PromptInput 与 Launchpad 共享；
// 行为逐字节不变，只是搬了家）。


import { resolve } from 'node:path'


import { setClipboard } from '../../../ink/termio/osc.js'

import { TerminalWriteContext } from '../../../ink/useTerminalNotification.js'


import { preserveSelection, type FileCandidate } from '../../../shared/platform/file-suggestions.js'
import { sanitizeEditableText, sanitizePastedText } from '../../../shared/platform/inputPaste.js'


import { mentionAtCaret } from '../../../shared/platform/mentions.js'


import { useInput, useTerminalSize, useTheme, type ScrollBoxHandle } from '../../../ui/primitives.js'

import { cursorGlyphColor, getTheme } from '../../../ui/theme.js'


import { filterLiveImageBindings, isUsableDraftSnapshot, resolveBindingGeneration, type PromptDraftImage } from '../model/promptDraftCache.js'
export { sanitizeEditableText, sanitizePastedText } from '../../../shared/platform/inputPaste.js'

/**
 * Visible text of the session-entry control at the head of the input row:
 * U+2338 APL FUNCTIONAL SYMBOL QUAD COLON plus a separator space.
 *
 * The glyph is chosen for ONE property above all others: the layout model and
 * the terminal cell table must agree on how many columns it occupies. `\u2338`
 * is a plain single-cell symbol with no emoji presentation, so
 * `stringWidth` and the terminal both say 1 + 1 = 2 and
 * {@link HOME_BUTTON_COLS} can be derived rather than guessed.
 *
 * The emoji house (`U+1F3E0`) was tried and rejected on this exact ground: it
 * costs the terminal ONE cell while `stringWidth` charges the row TWO, and
 * appending VARIATION SELECTOR-15 (text presentation) does not change either
 * number. That standing one-column disagreement put every caret-relative
 * column in the composer off by one, so no offset compensation made it work.
 */


/**
 * Paste fold with a visible preview and no black box:
 * a paste that leaves the input this big folds into a one-line chip
 * showing the line/char count PLUS the first line of content. Hover peeks
 * at the full text (window pinned to the head); clicking the chip — or
 * the `▾` prefix on the first row while expanded — toggles the fold; Esc
 * or any editing key unfolds first. Enter still submits the FULL text:
 * folding never drops data.
 */


/** Read one regular file through one descriptor, bounded to `maxBytes + 1`.
 * The extra byte detects a file that grows after fstat; a short read detects
 * shrinkage. This avoids stat(path) → readFile(path)'s path-swap TOCTOU and
 * never allocates from an untrusted size before the profile limit is checked. */


/**
 * The empty input deliberately shows NO placeholder text: terminal emulators
 * paint the IME preedit (pinyin) at the physical cursor, which the app parks
 * on the caret's cell, and the app receives no input events while a
 * composition is active (Windows Terminal suppresses key events during TSF
 * composition) — so it can never hide a placeholder in time. Keeping the row
 * blank while empty is what guarantees the preedit has nothing to overlay.
 */

/** Max input rows before the visible viewport starts scrolling; the box keeps
 *  a stable height. */


/**
 * Double-click self-detection window: two clicks within this many ms and
 * one cell (in either axis) of each other count as a double-click and
 * select the word under the pointer. The drag protocol resets the ink
 * multi-click chain on every press inside a drag target (the value box
 * carries onDragStart), so the prompt detects the double-click itself.
 */


/**
 * Live composer handle for Chat's global key rules and external draft actions.
 * Chat listens first, so delegated editing actions stay with their state owner.
 * Populated after each commit; null while unmounted or suspended.
 */


/**
 * Owner-held slot for the composer draft, so a screen that unmounts the
 * prompt (every early return in Chat) does not discard what the user typed.
 *
 * The composer writes ONE complete snapshot as it unmounts and consumes it on
 * the way back; the shape and the reasoning live in `promptDraftCache.ts`.
 */


/**
 * dsh-TUI prompt input: rounded border box (top+bottom borders
 * only), `❯ ` prompt char (dimmed while a turn is working), the text with a
 * block cursor at the cursor position, and above it the slash-command /
 * file-completion suggestion card (SuggestionCard: rounded panel with the
 * selected row behind a `❯` pointer in the theme's `suggestion` color).
 *
 * Empty input: a solid block caret on a blank cell and nothing else — no
 * placeholder text, so the terminal-painted IME preedit (pinyin) at the
 * parked cursor can never be overlaid on anything.
 *
 * Multi-line: Shift+Enter inserts a newline; ↑/↓ move between lines while
 * the input spans multiple lines (history/command selection otherwise); the
 * visible window scrolls to keep the caret row on screen past
 * MAX_VISIBLE_LINES. Enter submits, backspace/delete edit, ←/→ move the
 * cursor, Tab completes the selected command, Ctrl+G opens the draft in the
 * external editor ($VISUAL/$EDITOR), Escape clears (or closes the help
 * menu), `?` toggles the help menu. Windows ConPTY pipelines deliver
 * whole lines with the Enter key lost: a trailing CR/LF in the input marks
 * a complete line to submit.
 *
 * Enter submits immediately even while the model is streaming — as a STEER
 * (Codex/pi semantics): the message is injected at the next step boundary
 * of the running turn and the agent continues without aborting; Tab instead
 * queues the message for after the turn (followup). Both appear in a
 * pending preview above the input until delivered. Alt+Up pulls the last
 * pending message back for editing; Esc (with pending messages while
 * working) interrupts the turn and delivers them right away; Ctrl+Enter
 * aborts the turn and sends the current input immediately.
 */
export function PromptInput({
  composer,
  context,
  toastSuppressed,
  suspended = false,
  draftCache,
  helpOpen,
  onToggleHelp,
  onRunCommand,
  beforeSubmit,
  selectionActive,
  fillText,
  onFillConsumed,
  onOpenSessions,
  controllerRef,
  now = Date.now,
}: PromptInputProps) {
  React.useSyncExternalStore(composer.store.subscribe, composer.store.getSnapshot)
  React.useSyncExternalStore(context.sessions.subscribe, context.sessions.getSnapshot)
  React.useSyncExternalStore(context.settings.subscribe, context.settings.getSnapshot)
  React.useSyncExternalStore(context.workbench.subscribe, context.workbench.getSnapshot)
  const [themeName] = useTheme()
  /**
   * Caret fill. The face is self-drawn (the native cursor is hidden), and it
   * used to be `inverse` only — i.e. always the ink color, which a theme whose
   * input surface is already ink-adjacent cannot make readable. `cursor` names
   * the block fill, and the glyph on it is whichever ink contrasts with that
   * fill (cursorGlyphColor) — `inverseText` alone cannot serve a light caret;
   * empty keeps the inverse-video caret for palettes that predate the key.
   *
   * A palette a legacy runtime resolver returns can be missing the key
   * altogether (normalizeThemePalette hands such a palette back untouched), so
   * the undefined case normalizes here — ONE place, both consumers below read
   * `''` and take the inverse path. Without it the caret renders with no
   * background at all (the native cursor is hidden: the caret disappears).
   */
  const cursorTheme = getTheme(themeName)
  const cursorColor = cursorTheme.cursor ?? ''
  const cursorGlyph = cursorGlyphColor(cursorTheme)
  // Raw stdout writer for OSC 52 clipboard writes (selection copy) — must
  // bypass the frame pipeline; null outside a mounted Ink App.
  const writeRaw = React.useContext(TerminalWriteContext)
  // The composer owns its text in local state, so it starts EMPTY and adopts
  // whatever draft the owner stored in a MOUNT-TIME effect below. Reading the
  // store in this initializer instead looks equivalent and is not: a non-empty
  // first frame leaves `repro-resume-position` red — resuming a session parks
  // the transcript mid-history instead of pinning it to the newest message.
  // Adopting after mount keeps the first frame identical to a fresh composer
  // while still handing the draft back.
  const [value, setValue] = React.useState('')
  const [cursor, setCursor] = React.useState(0)
  /**
   * Adopt the owner's draft ONCE, after mount.
   *
   * This is where a screen swap gives the draft back: the slot outlives this
   * component, so a remount picks up what the user had written — text, caret,
   * the image bindings behind the visible `[Image #N]` tokens, and the edit
   * fold state around them.
   *
   * It runs as an effect rather than as the `useState` initial value on
   * purpose. A composer whose FIRST frame is already non-empty moves the
   * transcript's restored scroll position (`repro-resume-position`); adopting
   * after the first commit keeps that frame identical to a fresh composer. The
   * slot is consumed here, and the composer never writes to it while mounted,
   * so the empty first value cannot overwrite the draft before this reads it.
   */
  const adoptDraft = React.useRef(true)
  React.useEffect(() => {
    if (draftCache === undefined || !adoptDraft.current) return
    adoptDraft.current = false
    const snapshot = draftCache.current
    draftCache.current = null
    if (!isUsableDraftSnapshot(snapshot, String(context.sessions.getSnapshot().agentId), resolveBindingGeneration({ agentBindingGeneration: context.sessions.getSnapshot().agentBindingGeneration, stagedImageGeneration: composer.commands.stagedImageGeneration }))) return
    const text = snapshot.value
    // Restore the fold before adopting text and its caret.
    updateFoldBlock(snapshot.foldBlock)
    if (text === '') return
    const restoredCursor = normalizeCursorOffset(text, snapshot.cursor)
    replaceDraftImages(filterLiveImageBindings(
      snapshot.images,
      stageId => composer.commands.hasStagedImage?.(stageId) === true,
    ).map(([token, stageId]) => ({ token, stageId })))
    valueRef.current = text
    cursorRef.current = restoredCursor
    setValue(text)
    setCursor(restoredCursor)
  }, [draftCache])
  /**
   * Mouse text selection: UTF-16 offsets [start, end) in `value`, snapped
   * to grapheme boundaries, start ≤ end. Null = no selection. Created by
   * drag, Shift+click extension and double-click word select; consumed by
   * Backspace/Delete/typing; Esc clears it without touching the text.
   * With a fold block the range always stays inside the head or the tail
   * (it never crosses the chip row — clamped on every write).
   */
  const [selection, setSelection] = React.useState<{ start: number; end: number } | null>(null)
  const selectionRef = React.useRef<{ start: number; end: number } | null>(null)
  /** Anchor offset of the in-flight drag gesture (set by dragstart). */
  const dragAnchorRef = React.useRef<number | null>(null)
  /** Double-click self-detection: last click's timestamp/screen cell. */
  const lastClickAtRef = React.useRef(0)
  const lastClickColRef = React.useRef(-1)
  const lastClickRowRef = React.useRef(-1)
  /**
   * Draft-scoped undo stack (word-level `Ctrl+Z`). This is the DRAFT's own
   * history: a submit, a recall or a session switch ends it. Entries hold image
   * bindings exactly like the draft does, so dropping one must release the
   * capabilities only it kept alive.
   */
  const draftUndoRef = React.useRef<DraftUndoEntry[]>([])
  /**
   * Fold block: the [start, end) span of `value` that renders as
   * a one-line chip while the text around it stays fully editable. Created
   * by a big paste; only an EXPLICIT expand (chip/card click, Esc) or
   * delete removes it — typing NEVER unfolds the block.
   */
  const [foldBlock, setFoldBlock] = React.useState<{ start: number; end: number } | null>(null)
  /** Synchronous mirror used by batched keys, controller clear, and mouse drag. */
  const foldBlockRef = React.useRef<{ start: number; end: number } | null>(null)
  /** Hover state of the ⌂ session-list affordance at the head of the row. */
  const [homeHovered, setHomeHovered] = React.useState(false)
  /** Pointer over the input box (drives the hover peek card). */
  const [hovered, setHovered] = React.useState(false)
  /** Highlighted row of the docked-queue selector (null = inactive; the
   *  index runs over the docked subset of `composer.store.getSnapshot().pending`, oldest first).
   *  The ref mirrors it for the deferred consumeEscape controller closure. */
  const [dockSelected, setDockSelectedState] = React.useState<number | null>(null)
  const dockSelectedRef = React.useRef<number | null>(null)
  const setDockSelected = (index: number | null): void => {
    dockSelectedRef.current = index
    setDockSelectedState(index)
  }
  /** 120ms grace so the pointer crossing the input border row from the
   *  chip up onto the peek card never flickers the card. */
  const hoverLeaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverEnter = React.useCallback(() => {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current)
      hoverLeaveTimerRef.current = null
    }
    setHovered(true)
  }, [])
  const hoverLeave = React.useCallback(() => {
    if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current)
    hoverLeaveTimerRef.current = setTimeout(() => setHovered(false), 120)
  }, [])
  const valueRef = React.useRef(value)
  const cursorRef = React.useRef(cursor)
  const history = React.useRef<PromptHistoryEntry[]>([])
  const historyIndex = React.useRef(-1)
  const historyDraft = React.useRef<PromptHistoryEntry>({ text: '', images: [] })
  /** The persisted history is read lazily, once per mount and project: the
   * normalized project key it was seeded for, so a workspace switch re-seeds
   * (see seedHistory) while a respelled path to the same directory does not.
   * `null` = never seeded; `''` = seeded without a workspace. */
  const historySeededProject = React.useRef<string | null>(null)
  /** Visible `[Image #N]` labels are presentation only; this sidecar carries
   * the non-reusable capability for the current draft. History/rewind text
   * restored without this map can never bind to a later image by accident. */
  const draftImagesRef = React.useRef(new Map<string, string>())
  const draftImagesGenerationRef = React.useRef(composer.commands.stagedImageGeneration?.() ?? 0)
  /** Session generation fences one agent transcript; revision fences one
   * logical composer draft inside that session. Ordinary typing deliberately
   * keeps the revision so an async paste lands at the live caret, while any
   * whole-draft replacement revokes the old continuation. */
  const draftRevisionRef = React.useRef(0)
  /** Unlike draftRevision (whole-draft replacement only), this advances on
   * every text mutation so an async command can never clear a draft that was
   * edited away and later changed back to the same bytes. */
  const inputEditSequenceRef = React.useRef(0)
  /** One registry command may own a draft at a time. Keeping the draft
   * visible during admission must not make a second Enter dispatch it twice. */
  const pendingCommandRef = React.useRef<{
    readonly token: symbol
    readonly generation: number
    readonly revision: number
    readonly editSequence: number
  } | null>(null)
  const nextImageNumberRef = React.useRef(1)
  /** Serialize image staging started in one draft so consecutive terminal
   * drops keep input order even when storage settles out of order. A new
   * logical draft receives a fresh chain and never waits on old-session I/O. */
  const imageStageChainRef = React.useRef<Promise<void>>(Promise.resolve())
  const advanceDraftRevision = (): void => {
    draftRevisionRef.current += 1
    imageStageChainRef.current = Promise.resolve()
  }
  const { detachDraftImages, stageIdIsRetained, discardUnretainedImages, discardDraftImages, replaceDraftImages, syncImageGeneration, captureDraftImageLease, draftImageLeaseIsCurrent, restoreDraftImages } = createImageOwnership(() => ({ advanceDraftRevision, draftImagesRef, clearDraftUndo, draftUndoRef, history, historyDraft, composer, context, draftImagesGenerationRef, nextImageNumberRef, draftRevisionRef }))




  const { clearDraftUndo, pushDraftUndo, recordDraftEdit, clearDraftUndoably, undoDraft } = createDraftUndo(() => ({ draftUndoRef, discardUnretainedImages, now, imageRefsFor, syncImageGeneration, valueRef, cursorRef, foldBlockRef, discardDraftImages, setInput, setSelectedCommand, setFileSelected, advanceDraftRevision, replaceDraftImages, updateFoldBlock }))


  /** Push one step and enforce the depth/character guards. */

  /**
   * Record one real text mutation. `group` folds it into the current step when
   * the direction, caret continuity, idle window and word rule all agree;
   * `step` always starts a sealed step. A chunk carrying several characters is
   * judged per mutation, never per stdin read.
   */

  /**
   * Clear the draft while keeping ONE undo step, so `Ctrl+Z` can bring the
   * whole draft back (text, caret, images and fold block). The snapshot is
   * taken before the images are released: afterwards the capabilities would
   * already be gone and the restored `[Image #N]` tokens would be inert.
   */






  // Channel emits on every session replacement. Clear the sidecar during
  // that render while leaving the user's visible draft untouched; any raw
  // tokens become explicit stale placeholders instead of aliases.
  syncImageGeneration()
  valueRef.current = value
  cursorRef.current = cursor
  // Nothing is written to the owner's draft slot here — see the unmount
  // hand-off below. A commit-time write would run BEFORE the restore effect
  // has consumed the slot, so the composer's own first (empty) value would
  // erase the draft it just came back for.
  // Publish the live controller (fresh closure over `value` every render).
  // A prompt-slot panel withdraws the handle in the same commit: external
  // injection must not append/submit a hidden command draft while it waits
  // for a decision. clear() mirrors the double-tap-Esc clear.
  React.useLayoutEffect(() => {
    if (!controllerRef) return
    if (suspended) {
      controllerRef.current = null
      return
    }
    controllerRef.current = {
      hasText: () => value.length > 0,
      text: () => valueRef.current,
      clear: () => {
        if (valueRef.current !== '') inputEditSequenceRef.current += 1
        valueRef.current = ''
        cursorRef.current = 0
        selectionRef.current = null
        discardDraftImages()
        foldBlockRef.current = null
        dragAnchorRef.current = null
        lastClickAtRef.current = 0
        lastClickColRef.current = -1
        lastClickRowRef.current = -1
        setSelection(null)
        setFoldBlock(null)
        setValue('')
        setCursor(0)
      },
      append: (text: string) => {
        const previous = valueRef.current
        const next = sanitizeEditableText(previous + text)
        if (next !== previous) inputEditSequenceRef.current += 1
        // An external injection is a NEW draft baseline. It bypasses setInput,
        // so the stack would still describe the pre-injection text: one Ctrl+Z
        // would then erase the injected text together with the typing it
        // joined (the injection is not an edit of the draft the user made).
        if (next !== previous) clearDraftUndo()
        valueRef.current = next
        cursorRef.current = next.length
        setValue(next)
        setCursor(next.length)
        return next
      },
      consumeSelectionCopy: () => {
        const sel = selectionRef.current
        if (!sel) return false
        const text = valueRef.current.slice(sel.start, sel.end)
        void setClipboard(text).then(raw => {
          if (raw) writeRaw?.(raw)
        })
        // The selection stays: copy never clears it (Esc/typing/delete do).
        return true
      },
      consumeEscape: consumeEditingEscape,
    }
    return () => {
      controllerRef.current = null
    }
  })
  const [selectedCommand, setSelectedCommand] = React.useState(0)
  // ctrl+r history fill: replace the input when a new fill arrives, then
  // tell the caller to clear it.
  const lastFill = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (fillText && fillText !== lastFill.current) {
      lastFill.current = fillText
      syncImageGeneration()
      discardDraftImages()
      updateFoldBlock(null)
      // A recall is not undoable (D4): the stack was just cleared above, so
      // the fill must not push a snapshot of the draft it replaced.
      setInput(fillText, fillText.length, 'silent')
      onFillConsumed?.()
    }
  }, [fillText, onFillConsumed])
  // Double-tap Esc to clear.
  const clipboardBusyRef = React.useRef(false)
  /** True while the external editor owns the terminal (editor-key round-trip). */
  const editorBusyRef = React.useRef(false)
  /** Enter dedupe window: cmd pipelines can deliver one Enter as `\r`+`\n`. */
  const lastEnterAtRef = React.useRef(0)
  React.useEffect(() => {
    return () => {
      if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current)
      /**
       * Hand the draft to the owner's slot as this component goes away.
       *
       * This is the ONLY write to that slot, and it belongs here: it happens at
       * the instant a screen replaces the composer, so it can neither race the
       * restore effect nor change the transcript's first frame.
       *
       * `advanceDraftRevision` invalidates any image read/stage still in
       * flight, so a late continuation cannot bind a capability into a composer
       * that no longer exists. `clearDraftUndo` release the
       * capabilities that only an undo stack was holding: they are not part of
       * the draft, and nothing will ever restore them once this composer is
       * gone.
       *
       * The stageIds the DRAFT holds are deliberately NOT revoked — they are
       * part of the snapshot the slot now keeps, and the restore filters out
       * whatever the composer revoked in the meantime. Revoking them here is why
       * an image draft used to come back as inert text.
       */
      advanceDraftRevision()
      clearDraftUndo()

      const images: PromptDraftImage[] = [...draftImagesRef.current.entries()]
        .map(([token, stageId]) => [token, stageId] as const)
      draftImagesRef.current.clear()
      if (draftCache === undefined) {
        discardUnretainedImages(images.map(image => image[1]))
        return
      }
      const text = valueRef.current
      const editState = foldBlockRef.current !== null
      if (text === '' && images.length === 0 && !editState) {
        draftCache.current = null
        return
      }
      draftCache.current = {
        ownerAgentId: String(context.sessions.getSnapshot().agentId),
        bindingGeneration: resolveBindingGeneration({ agentBindingGeneration: context.sessions.getSnapshot().agentBindingGeneration, stagedImageGeneration: composer.commands.stagedImageGeneration }),
        value: text,
        cursor: cursorRef.current,
        foldBlock: foldBlockRef.current,
        images,
      }
    }
  }, [])
  const { columns, rows: terminalRows } = useTerminalSize()
  React.useEffect(() => {
    // PromptInput self-detects double-clicks because its drag target resets
    // App's global chain. Geometry changed across resize, so the same screen
    // cell no longer identifies the same grapheme.
    lastClickAtRef.current = 0
    lastClickColRef.current = -1
    lastClickRowRef.current = -1
  }, [columns, terminalRows])
  const helpScrollRef = React.useRef<ScrollBoxHandle | null>(null)
  // Help viewport budget: the overlay anchors at the composer's top edge
  // (OverlayAbove bottom:'100%') and grows UP, so its budget is the space
  // ABOVE that anchor — smallest on an empty session, where the whale
  // splash (~15 rows) sits between the screen top and the composer
  // (terminalRows minus chrome only applies once the transcript fills the
  // viewport). Take the conservative intersection: 15 rows of viewport (16
  // with the hint + margin) fits the empty-session anchor on the default
  // layout at any terminal size, and the renderer's bottom-anchored
  // clipping for absolute overlays (no negative-y clamp) then never has
  // to eat the overlay's FIRST rows — the shortcut-column headers. The
  // command registry scrolls inside the viewport, so a taller terminal
  // loses nothing functional. (PR #446; restored after the picker
  // snapshot's cherry-pick resurrected the old formula.)
  const helpViewportHeight = Math.max(3, Math.min(terminalRows - 7, 15))

  const suggestions = value.startsWith('/') ? composer.commands.commandCompletions(value) : []
  const overlayOpen =
    suggestions.length > 0 &&
    !helpOpen &&
    !selectionActive &&
    !value.includes('\n')

  // `@` file completion (issue #15): the trigger is the mention token at the
  // CARET, so `@` works mid-message (`看看 @src/a.ts 这个`), not only when it
  // is the input's first character. The cwd listing loads when the trigger
  // appears.
  const [fileMatches, setFileMatches] = React.useState<readonly FileCandidate[]>([])
  const [fileSelected, setFileSelected] = React.useState(0)
  const mention = mentionAtCaret(value, cursor)
  const atTrigger = mention !== undefined
  const fileRequestId = React.useRef(0)
  const selectedFile = fileMatches[fileSelected]
  React.useEffect(() => {
    const requestId = ++fileRequestId.current
    if (!mention) {
      setFileMatches([])
      setFileSelected(0)
      return
    }
    const previous = selectedFile
    // Deps key on `mention.query` (and trigger on/off) only: cursor movement
    // within the same token must NOT refetch, and `selectedFile`/`fileSelected`
    // are read as their render-time values only to seed selection preservation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    void composer.commands.listFileCandidates(mention.query, { topK: 50 }).then(next => {
      if (requestId !== fileRequestId.current) return
      setFileMatches(next)
      setFileSelected(preserveSelection(previous, next, fileSelected))
    })
  }, [composer, mention?.query, atTrigger])
  // Esc dismisses the overlay for the token being edited (it reopens once the
  // text changes); it must NOT clear a mid-message input.
  const fileEscRef = React.useRef(-1)
  React.useEffect(() => {
    fileEscRef.current = -1
  }, [value])
  const fileOverlayOpen =
    fileMatches.length > 0 &&
    !helpOpen &&
    !selectionActive &&
    fileEscRef.current !== mention?.start

  /**
   * The `[Image #N]` tokens of `text` that carry a live draft capability.
   * These are atomic: the caret never rests inside one, ←/→ step over the
   * whole token, Backspace at its end / Delete at its start remove it whole,
   * a selection never cuts it, and it renders as a chip (the whole token is
   * the caret cluster when the caret sits at its start). A raw token typed
   * or restored without a capability is ordinary text.
   */
  const { boundImageSpans, placeCaret, updateFoldBlock, setInput, deleteInputRange, updateSelection, clearSelection, imageRefsFor, warnStaleImageTokens } = createDraftEditing(() => ({ draftImagesRef, valueRef, cursorRef, setCursor, foldBlockRef, setFoldBlock, dockSelectedRef, setDockSelected, clearDraftUndo, recordDraftEdit, inputEditSequenceRef, stageIdIsRetained, composer, context, selectionRef, setSelection, setValue, syncImageGeneration }))


  /** Move the caret to `offset`, snapped off any token interior. */


  /** Fold-block state + a synchronous mirror (setInput reads the ref).
   *  Creating a block also drags a caret that sits inside it out to the
   *  block's end (the block is atomic; typing continues after it). */


  /**
   * Apply `next` at `cursorOffset` and record the edit on the undo stack.
   * `snapshotBlock` overrides the block the step snapshots: a caller that must
   * clear the fold block BEFORE writing (the external-editor refill) still
   * wants the block that was live at edit time.
   */




  /**
   * Write the selection [start, end) (snapped to grapheme boundaries,
   * start ≤ end); a degenerate range clears it. With a fold block the
   * range is clamped into the side that holds `start` — the block is
   * atomic and a selection may never cross the chip row.
   */


  /** Drop the selection without touching text or caret. */


  /**
   * Accept the selected file suggestion: replace ONLY the mention token at
   * the caret (prefix/suffix text survives), quoting whitespace paths. A
   * directory inserts `@dir/` without a trailing space so completion
   * continues into it; a file completes the token with a space. A typed
   * `#L12-14` suffix is NOT part of the replacement — completion ends at
   * `pathEnd` so the line range survives acceptance (issue #359).
   */
  const acceptFile = (candidate: FileCandidate) => {
    if (!mention) return
    const file = candidate.path
    const body = /\s/.test(file) ? `@"${file}"` : `@${file}`
    // A typed `#L12-14` suffix rides along AFTER the completed body (before
    // the trailing space) — quoting a whitespace path must not detach it.
    const suffix = mention.pathEnd === undefined ? '' : value.slice(mention.pathEnd, mention.end)
    const insert = candidate.kind === 'directory' ? `${body}${suffix}` : `${body}${suffix} `
    const next = value.slice(0, mention.start) + insert + value.slice(mention.end)
    setInput(next, mention.start + insert.length, 'step')
    setFileSelected(0)
  }



  /**
   * Warn once when the text carries an `[Image #N]` placeholder that will
   * not attach an image: unbound in this draft (history, rewind, typed) or
   * bound to a staging the composer has since dropped. Channel routes
   * (submit, steer, registry commands) warn on their own; this covers the
   * lines the screen consumes locally, where the text is otherwise dropped
   * without a word.
   */


  /**
   * Seed the walk with the persisted history (issue #986). `↑`/`↓` used to
   * see only what this process submitted, so a restart lost every earlier
   * entry. Seeding before the first push keeps ONE chronological list —
   * persisted entries first, this run's submits behind them — instead of two
   * lists to merge at recall time. Restored text carries no image capability
   * (the file stores text only), which is also what keeps a recalled entry
   * from binding to a later staged image by accident. The walk is scoped to
   * the composer's workspace, keyed the same way the store keys it
   * (historyProjectKey), so a workspace switch re-seeds it with that
   * project's history instead of carrying the previous one over — and a
   * respelled path to the same directory is not a switch.
   * @returns Whether the re-seed cut short a walk in progress: the composer
   * then shows a recalled entry of the previous project while the draft that
   * walk started from is still held in `historyDraft`.
   */
  const { seedHistory, restoreHistoryDraft, rememberHistory, pullBackLast, retractRecalledCopy, editDocked } = createHistoryNavigation(() => ({ composer, context, historySeededProject, historyIndex, history, updateFoldBlock, restoreDraftImages, historyDraft, setInput, setDockSelected, setSelectedCommand, setFileSelected, dockedPending, valueRef, imageRefsFor, foldBlockRef, replaceDraftImages }))


  /** End the walk and put back the draft it started from. */




  const { clearDeliveredDraft, sameImageRefs, shellImagesUnsupported, submitText, steerSend, queueSend, sendDocked, interruptSend, tryRunCommand, chooseCommand, handleEnter } = createSubmission(() => ({ syncImageGeneration, detachDraftImages, setInput, setSelectedCommand, setFileSelected, composer, context, beforeSubmit, imageRefsFor, rememberHistory, setDockSelected, value, draftRevisionRef, inputEditSequenceRef, pendingCommandRef, captureDraftImageLease, valueRef, onRunCommand, warnStaleImageTokens, draftImageLeaseIsCurrent, lastEnterAtRef, dockSelectedRef, dockCount, editDocked, overlayOpen, suggestions, selectedCommand, fileOverlayOpen, fileMatches, fileSelected, acceptFile }))




  /** `!`/`!!` are host shell routes, not model messages. They have no image
   * grammar, so reject before history/clear just like a non-image command. */




  /**
   * `Ctrl+Z`: pop back to the state before the current undo step — text,
   * caret, images and fold block together. An empty stack is a no-op (never
   * the rewind picker, never a clear). The restore is `silent`, so repeated
   * Ctrl+Z walks further back instead of pushing what it just left.
   */




  /**
   * Enter while the model is working = STEER (Codex/pi semantics): the
   * message is injected at the next step boundary of the RUNNING turn and
   * the agent continues without aborting — the "immediate" send.
   */


  /**
   * Tab while the model is working = plain queue (followup): the message
   * waits for the running turn to end, then is processed in order.
   */


  /**
   * Alt+Up: pull the last pending message back into the input for editing
   * (never interrupts the running turn). Refused when the running dsh-agent
   * cannot withdraw inbox messages (released package without the inbox API).
   */


  /**
   * Withdraw the queued copy of the text `↑` just recalled (issue #986): the
   * message is still parked in the inbox, so editing it and sending again
   * would run the same text twice. Alt+Up withdraws explicitly; walking the
   * history to the same text has to land in the same place. The newest match
   * wins — `↑` walks newest-first and the queue is FIFO. A message the
   * running turn already claimed cannot be withdrawn, and saying so beats
   * pretending it was.
   */


  /**
   * The docked queue (Esc parked it while interrupting, Claude Code parity):
   * previews the composer keeps until the user sends them all (⏎ on an empty
   * draft / the clickable hint) or retracts items (the ↑ selector / Alt+↑).
   */
  const dockedPending = composer.store.getSnapshot().pending.filter(item => item.docked === true)
  const dockCount = dockedPending.length

  /** Send the whole dock now (⏎ on an empty draft, or the hint row click):
   *  FIFO, exactly once, through the composer's own delivery chain. */


  /** Retract one docked row into the draft for editing (selector ⏎, row
   *  click, Alt+↑ on the last): purely local — the backend dropped its copy
   *  with the aborted turn, so every backend can do it.
   *
   *  A draft with real content is never destroyed by the retraction: it
   *  SWAPS — the whole draft (text + staged images) parks at
   *  the dock's tail while the clicked row comes into the input. Nothing
   *  sends; the swap is one undo step, so Ctrl+Z brings the parked draft
   *  back (text, caret, images and fold block; the parked row retains the
   *  image capabilities, see stageIdIsRetained). Only an empty (or
   *  whitespace-only) draft takes the plain retraction path. */


  // A dock that empties or shrinks under an open selector (rows claimed,
  // a receipt un-docking them, a session reset) leaves the highlight
  // pointing past the list — fold it instead of steering arrows at an
  // invisible row.
  React.useEffect(() => {
    if (dockSelected !== null && (dockSelected >= dockCount || dockCount === 0)) {
      setDockSelected(null)
    }
  }, [dockSelected, dockCount])

  /**
   * Ctrl+Enter: abort the running turn and send the input immediately — the
   * model stops what it is doing and starts on this message right away.
   */


  /**
   * Execute a slash command (built-in, plugin-registered, or hidden) when
   * the input resolves to one: the name parses as the first token so
   * `/plan off` dispatches `plan` with its argument text, and the merged
   * command list (locals + registry) decides whether the line is a command
   * at all. Hidden commands are recognized even though they are intentionally
   * absent from the suggestion/help catalogs.
   */




  /**
   * The Enter path for prompt submission:
   * - command menu open → run the SELECTED command (never send `/mo`);
   * - model working → STEER into the running turn (next step boundary,
   *   agent continues — the "immediate" send; Codex/pi semantics);
   * - otherwise → submit directly (or run a unique command).
   * Reads valueRef so a key batch (typing + Enter in one stdin read)
   * operates on the text the preceding keys produced.
   */


  /** Local Esc layers, shared by the prompt listener and Chat's delegation.
   * Refs preserve this order even when expansion and Esc share a stdin batch. */
  const consumeEditingEscape = (): boolean => {
    // The docked-queue selector folds first: Esc leaves the selector and the
    // dock itself stays put (⏎/↑ keep working afterwards).
    if (dockSelectedRef.current !== null) {
      setDockSelected(null)
      return true
    }
    if (selectionRef.current && !helpOpen && !overlayOpen && !fileOverlayOpen) {
      clearSelection()
      return true
    }
    return false
  }

  /** Clipboard reads are asynchronous; insert against the latest render so
   * typing while PowerShell owns the clipboard never gets overwritten.
   * An active selection is replaced by the insert. Returns the resulting
   * value and the insertion offset so callers can apply the paste fold. */
  const { insertClipboardAtCaret, stageImagePath, enqueueImageWork, stagedImageNotice, discardStagedHandles, bindStagedImage } = createAttachments(() => ({ valueRef, selectionRef, cursorRef, setInput, setSelectedCommand, setFileSelected, draftImageLeaseIsCurrent, composer, context, draftImagesRef, imageStageChainRef, nextImageNumberRef }))


  /** Read one local image file and stage it through the composer, returning
   *  an opaque capability. Shared by every image paste path:
   *  clipboard bitmap export, Finder-copied files, and pasted drop paths.
   *  A Finder/drop path is untrusted input: one bounded descriptor read
   *  applies the profile limit before bytes enter the composer. */


  /** Queue one complete image operation (save plus synchronous bind/insert).
   * Keeping the visible mutation inside the chain makes terminal drop order
   * independent of attachment-store latency. Rejections settle the chain so
   * one bad file cannot wedge later drops. */


  /** Success notice for one staged image. An adapted paste says what the user
   *  actually got (stored dimensions, stored format, filled alpha) — naming it
   *  is the difference between a reported adaptation and a silently rewritten
   *  image. */




  /** Assign presentation numbering only after staging succeeds. Existing raw
   * tokens (including stale history) reserve their number, so a fresh image
   * can never visually alias one. The counter never goes backwards within
   * one session generation, which also keeps delete/undo safe. */


  /** Line index of the cursor; -1 when the cursor is at the very end. */
  const cursorLine = (text: string, cursorOffset: number) => {
    const before = text.slice(0, cursorOffset)
    return before.split('\n').length - 1
  }
  /** Column of the cursor within its line. */
  const cursorColumn = (text: string, cursorOffset: number) => {
    const before = text.slice(0, cursorOffset)
    const line = before.split('\n').pop() ?? ''
    return line.length
  }

  const head = foldBlock ? value.slice(0, foldBlock.start) : ''
  const tail = foldBlock ? value.slice(foldBlock.end) : ''

  useInput(createComposerKeyboard(() => ({ selectionActive, editorBusyRef, valueRef, cursorRef, selectionRef, consumeEditingEscape, deleteInputRange, setSelectedCommand, setFileSelected, foldBlockRef, updateFoldBlock, setInput, helpOpen, onToggleHelp, captureDraftImageLease, enqueueImageWork, stageImagePath, bindStagedImage, insertClipboardAtCaret, composer, context, stagedImageNotice, draftImageLeaseIsCurrent, clipboardBusyRef, draftImagesRef, discardStagedHandles, syncImageGeneration, advanceDraftRevision, handleEnter, chooseCommand, tryRunCommand, submitText, interruptSend, fileOverlayOpen, overlayOpen, fileMatches, fileSelected, acceptFile, suggestions, selectedCommand, queueSend, helpViewportHeight, helpScrollRef, pullBackLast, dockSelectedRef, setDockSelected, dockCount, historyIndex, cursorLine, tail, cursorColumn, seedHistory, history, restoreHistoryDraft, historyDraft, imageRefsFor, retractRecalledCopy, restoreDraftImages, head, undoDraft, clearDraftUndoably, fileEscRef, mention })), { isActive: !suspended })

  // === Render: hard-wrap every logical line at the input width, then show
  // the window of visual lines with the caret row always visible.
  // Narrow terminals: the usable width follows the real terminal down to a
  // single column — a fixed floor of 10 would wrap far too early and park
  // the declared cursor past the value box's actual width.
  // 行首会话入口占列：未传 onOpenSessions 时按钮整体不渲染，预算同步归还
  // （既有调用方的可用列数逐列不变）。用实测常量而不是 stringWidth：该字符
  // 是 U+1F3E0+VS15，stringWidth 按码点算 2（含 VS15 仍是 2），终端只给 1，
  // 见 HOME_BUTTON_COLS 的说明。
  return useComposerView({ onOpenSessions, composer, context, columns, foldBlock, value, cursor, hovered, selectionActive, cursorColor, boundImageSpans, selection, cursorGlyph, updateFoldBlock, hoverEnter, hoverLeave, toastSuppressed, suspended, lastClickAtRef, lastClickColRef, lastClickRowRef, updateSelection, placeCaret, selectionRef, cursorRef, clearSelection, dragAnchorRef, setCursor, foldBlockRef, valueRef, dockSelected, dockCount, dockedPending, helpOpen, fileOverlayOpen, overlayOpen, terminalRows, helpViewportHeight, helpScrollRef, setInput, onToggleHelp, editDocked, sendDocked, fileMatches, fileSelected, mention, acceptFile, setFileSelected, suggestions, selectedCommand, chooseCommand, setSelectedCommand, setHovered, setHomeHovered, homeHovered })
}

/**
 * Grapheme word-wrap for one logical line: break at the last space when
 * the row overflows; hard-wrap a word that cannot fit; never split a
 * cluster (ZWJ emoji, combining sequences, CJK wide cells stay whole).
 */


/** Wrap text to `width` columns via {@link wrapLineRows} (newlines honoured). */


/**
 * Locate `offset` in the wrapped layout of `text`. Uses the full wrap —
 * not a prefix — so a cursor inside a carried word maps to the displayed
 * row. At a wrap join the caret stays on the earlier row (after the space).
 */


/**
 * Inverse of {@link wrapToWidth}: map a click position (visual row index +
 * visual column) back to a UTF-16 offset in the original text. Uses the
 * same {@link wrapLineRows} row boundaries, so every visual row's start
 * offset is known exactly. Within the clicked row, the caret snaps to the
 * boundary nearest the click: a grapheme whose midpoint lies past the
 * click column takes the caret before it, otherwise after.
 */


/**
 * Offset range [start, end) of every visual row, using the same {@link
 * wrapLineRows} boundaries as `wrapToWidth`. The selection highlight
 * intersects each row with these ranges so offsets map 1:1 onto the
 * rendered row strings.
 */


/** Word characters for double-click selection: letters (any script),
 *  digits and the punctuation set terminal emulators treat as word-part by
 *  default (`/usr/bin/bash` selects whole — iTerm2 defaults). */


/** Character class for double-click word expansion: whitespace, word
 *  char, everything else (punctuation/symbols). A same-class grapheme
 *  run is one word. */


/**
 * Word selection around `offset` within [lo, hi): expand left/right over
 * grapheme clusters of the same class as the clicked one (terminal
 * double-click semantics — punctuation runs select as one). Returns null
 * when the offset sits at the range's end (nothing to select).
 */


export { composerImageRefsForText } from '../model/image-tokens.js'
