


import { COMPOSER_IMAGE_TOKEN, snapOffImageToken, expandImageTokenRange } from '../../model/image-tokens.js'
import type { ImageTokenSpan } from '../../model/image-tokens.js'

import { normalizeCursorOffset } from '../../model/editing.js'
import type { DraftUndoEntry, UndoMode } from '../../model/editing.js'
import { imageTokenSpans, composerImageRefsForText } from '../../model/image-tokens.js'
import React from 'react'


import type { ComposerImageRef } from '../../../../shared/protocol/composer.js'
import { t } from '../../../../shared/i18n.js'
import type { ComposerPort as Channel } from '../../contracts.js'


import { sanitizeEditableText } from '../../../../shared/platform/inputPaste.js'


interface Context {
  readonly draftImagesRef: React.RefObject<Map<string, string>>
  readonly valueRef: React.RefObject<string>
  readonly cursorRef: React.RefObject<number>
  readonly setCursor: React.Dispatch<React.SetStateAction<number>>
  readonly foldBlockRef: React.RefObject<{ start: number; end: number; } | null>
  readonly setFoldBlock: React.Dispatch<React.SetStateAction<{ start: number; end: number; } | null>>
  readonly dockSelectedRef: React.RefObject<number | null>
  readonly setDockSelected: (index: number | null) => void
  readonly clearDraftUndo: () => void
  readonly recordDraftEdit: (prev: string, prevCursor: number, block: DraftUndoEntry["block"], next: string, nextCursor: number, mode: "group" | "step") => void
  readonly inputEditSequenceRef: React.RefObject<number>
  readonly stageIdIsRetained: (stageId: string) => boolean
  readonly channel: Channel
  readonly selectionRef: React.RefObject<{ start: number; end: number; } | null>
  readonly setSelection: React.Dispatch<React.SetStateAction<{ start: number; end: number; } | null>>
  readonly setValue: React.Dispatch<React.SetStateAction<string>>
  readonly syncImageGeneration: () => number
}

export function createDraftEditing(getContext: () => Context) {
const boundImageSpans = (text: string): ImageTokenSpan[] =>
    {
    const { draftImagesRef } = getContext()

return imageTokenSpans(text).filter(span => draftImagesRef.current.has(span.token))
  }

const placeCaret = (offset: number, prefer: 'start' | 'end' | 'nearest'): void => {
    const { valueRef, cursorRef, setCursor } = getContext()


    const snapped = snapOffImageToken(boundImageSpans(valueRef.current), offset, prefer)
    cursorRef.current = snapped
    setCursor(snapped)
  }

const updateFoldBlock = (block: { start: number; end: number } | null) => {
    const { foldBlockRef, setFoldBlock, cursorRef, setCursor } = getContext()


    foldBlockRef.current = block
    setFoldBlock(block)
    if (block) {
      const c = cursorRef.current
      if (c > block.start && c < block.end) {
        cursorRef.current = block.end
        setCursor(block.end)
      }
    }
  }

const setInput = (
    next: string,
    cursorOffset = next.length,
    undo: UndoMode = 'group',
    snapshotBlock?: DraftUndoEntry['block'],
  ) => {
    const { valueRef, cursorRef, foldBlockRef, dockSelectedRef, setDockSelected, clearDraftUndo, recordDraftEdit, inputEditSequenceRef, draftImagesRef, stageIdIsRetained, channel, selectionRef, setSelection, setValue, setCursor } = getContext()


    // Apply the same ingress normalization to fills/history/editor results as
    // to paste. Map the requested caret through the sanitized prefix so an
    // ANSI sequence removed before it cannot leave the caret past the text.
    const sanitizedCursor = sanitizeEditableText(next.slice(0, cursorOffset)).length
    next = sanitizeEditableText(next)
    cursorOffset = sanitizedCursor
    const prev = valueRef.current
    const prevCursor = cursorRef.current
    const block = foldBlockRef.current
    // Normalize onto a grapheme boundary (also clamps into range): every
    // caller passes a caret they believe is on a character edge — paste
    // merges, history fills, and IME composition can still hand back an
    // offset inside a surrogate pair or combining cluster.
    let offset = normalizeCursorOffset(next, cursorOffset)
    if (block) {
      // Fold block is atomic: the caret never lands INSIDE [start, end).
      if (offset > block.start && offset < block.end) {
        offset = offset - block.start < block.end - offset ? block.start : block.end
      }
      // Every real edit happens AT the caret, so a block that starts at or
      // after the caret shifts with the value delta; one fully past the
      // caret is untouched. Whole-value replacements (fill/history/editor)
      // clear the block explicitly at their call sites.
      const delta = next.length - prev.length
      let start = block.start
      let end = block.end
      if (prevCursor <= block.start) {
        start += delta
        end += delta
      }
      start = Math.max(0, Math.min(start, next.length))
      end = Math.max(start, Math.min(end, next.length))
      if (start >= end) updateFoldBlock(null)
      else if (start !== block.start || end !== block.end) updateFoldBlock({ start, end })
    }
    // Staged `[Image #N]` tokens are atomic: a caret that would land inside
    // one continues in its direction of travel (←/word-left/↑ → the token's
    // start, →/word-right/↓ → its end); with no travel, the nearer edge.
    offset = snapOffImageToken(
      boundImageSpans(next),
      offset,
      offset < prevCursor ? 'start' : offset > prevCursor ? 'end' : 'nearest',
    )
    // Undo bookkeeping runs before the mirrors move: it snapshots the state
    // this edit replaces, and `diffSpan` needs both texts. `reset` ends the
    // draft's history, `silent` (undo itself, a recall) leaves it untouched.
    if (next !== prev) {
      // Every real text change (typing, paste, history, external editor,
      // undo) hands the arrows back to the draft: a held-queue selection
      // must not survive an edited draft and steer ↑/↓ over the text.
      // Caret-only moves (next === prev) never land here.
      if (dockSelectedRef.current !== null) setDockSelected(null)
      if (undo === 'reset') clearDraftUndo()
      else if (undo !== 'silent') {
        recordDraftEdit(prev, prevCursor, snapshotBlock === undefined ? block : snapshotBlock, next, offset, undo)
      }
    }
    // The synchronous mirrors are what batch-dispatched events (one stdin
    // read → several keys, no render in between) read on their next turn.
    if (next !== prev) inputEditSequenceRef.current += 1
    valueRef.current = next
    cursorRef.current = offset
    // Deleting a visible token revokes its capability. Re-typing the same
    // label later must stay inert; only a fresh paste may mint a new binding.
    for (const [token, stageId] of draftImagesRef.current) {
      if (next.includes(token)) continue
      draftImagesRef.current.delete(token)
      if (!stageIdIsRetained(stageId)) channel.discardStagedImage(stageId)
    }
    // Every real edit drops the selection: its offsets describe the OLD
    // text. Selection-consuming callers (delete/replace) read it first.
    selectionRef.current = null
    setSelection(null)
    setValue(next)
    setCursor(offset)
  }

const deleteInputRange = (start: number, end: number, undo: UndoMode = 'group'): void => {
    const { valueRef } = getContext()


    if (start >= end) return
    const text = valueRef.current
    const range = expandImageTokenRange(boundImageSpans(text), start, end)
    setInput(text.slice(0, range.start) + text.slice(range.end), range.start, undo)
  }

const updateSelection = (start: number, end: number) => {
    const { valueRef, foldBlockRef, selectionRef, setSelection } = getContext()


    const text = valueRef.current
    const anchor = normalizeCursorOffset(text, start)
    let lo = normalizeCursorOffset(text, Math.min(start, end))
    let hi = normalizeCursorOffset(text, Math.max(start, end))
    const block = foldBlockRef.current
    if (block) {
      // Clamp by the ORIGINAL anchor side, not sorted `lo`: for a reverse
      // tail→head drag, `lo` is in the head even though the gesture belongs
      // to the tail. Both selection and caret must stay on the anchor side.
      if (anchor <= block.start) {
        hi = Math.min(hi, block.start)
      } else {
        lo = Math.max(lo, block.end)
        hi = Math.max(hi, block.end)
      }
    }
    // A selection never cuts a staged token: an edge inside one grows
    // outward to cover the whole token.
    const range = expandImageTokenRange(boundImageSpans(text), lo, hi)
    lo = range.start
    hi = range.end
    if (lo >= hi) {
      selectionRef.current = null
      setSelection(null)
    } else {
      selectionRef.current = { start: lo, end: hi }
      setSelection({ start: lo, end: hi })
    }
  }

const clearSelection = () => {
    const { selectionRef, setSelection } = getContext()


    selectionRef.current = null
    setSelection(null)
  }

const imageRefsFor = (text: string): ComposerImageRef[] => {
    const { syncImageGeneration, draftImagesRef } = getContext()


    syncImageGeneration()
    return composerImageRefsForText(text, draftImagesRef.current)
  }

const warnStaleImageTokens = (text: string, images: readonly ComposerImageRef[]): void => {
    const { channel } = getContext()


    const live = new Set(
      images
        .filter(image => channel.stagedImage(image.stageId) !== undefined)
        .map(image => image.token),
    )
    for (const match of text.matchAll(COMPOSER_IMAGE_TOKEN)) {
      if (live.has(match[0])) continue
      channel.notify(t('input-image-token-stale', { token: match[0] }), { color: 'warning', timeoutMs: 5000 })
      return
    }
  }
  return { boundImageSpans, placeCaret, updateFoldBlock, setInput, deleteInputRange, updateSelection, clearSelection, imageRefsFor, warnStaleImageTokens }
}
