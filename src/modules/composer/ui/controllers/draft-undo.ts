


import { isDraftWordBoundary } from '../../../../shared/platform/draftWordBoundary.js'

import { UNDO_LIMIT, UNDO_MAX_CHARS, UNDO_IDLE_MS, diffSpan, startDeleteRun, extendDeleteRun } from '../../model/editing.js'


import type { DraftUndoEntry, UndoMode } from '../../model/editing.js'

import React from 'react'


import type { ComposerImageRef } from '../../../../shared/protocol/composer.js'


interface Context {
  readonly draftUndoRef: React.RefObject<DraftUndoEntry[]>
  readonly discardUnretainedImages: (stageIds: Iterable<string>) => void
  readonly now: () => number
  readonly imageRefsFor: (text: string) => ComposerImageRef[]
  readonly syncImageGeneration: () => number
  readonly valueRef: React.RefObject<string>
  readonly cursorRef: React.RefObject<number>
  readonly foldBlockRef: React.RefObject<{ start: number; end: number; } | null>
  readonly discardDraftImages: (options?: { keepUndo?: boolean; }) => void
  readonly setInput: (next: string, cursorOffset?: number, undo?: UndoMode, snapshotBlock?: DraftUndoEntry["block"]) => void
  readonly setFileSelected: React.Dispatch<React.SetStateAction<number>>
  readonly advanceDraftRevision: () => void
  readonly replaceDraftImages: (images: readonly ComposerImageRef[]) => void
  readonly updateFoldBlock: (block: { start: number; end: number; } | null) => void
}

export function createDraftUndo(getContext: () => Context) {
const clearDraftUndo = (): void => {
    const { draftUndoRef, discardUnretainedImages } = getContext()


    const previous = draftUndoRef.current
    draftUndoRef.current = []
    discardUnretainedImages(previous.flatMap(entry => entry.images.map(image => image.stageId)))
  }

const pushDraftUndo = (
    snapshot: Omit<DraftUndoEntry, 'atMs' | 'caretAfter' | 'kind' | 'deleteRun'>,
    kind: DraftUndoEntry['kind'],
    caretAfter: number | null,
    deleteRun: DraftUndoEntry['deleteRun'] = null,
  ): void => {
    const { draftUndoRef, now, discardUnretainedImages } = getContext()


    draftUndoRef.current.push({ ...snapshot, atMs: now(), caretAfter, kind, deleteRun })
    const dropped: DraftUndoEntry[] = []
    while (draftUndoRef.current.length > UNDO_LIMIT) dropped.push(draftUndoRef.current.shift()!)
    let chars = draftUndoRef.current.reduce((total, entry) => total + entry.text.length, 0)
    while (chars > UNDO_MAX_CHARS && draftUndoRef.current.length > 1) {
      const oldest = draftUndoRef.current.shift()!
      chars -= oldest.text.length
      dropped.push(oldest)
    }
    if (dropped.length > 0) {
      discardUnretainedImages(dropped.flatMap(entry => entry.images.map(image => image.stageId)))
    }
  }

const recordDraftEdit = (
    prev: string,
    prevCursor: number,
    block: DraftUndoEntry['block'],
    next: string,
    nextCursor: number,
    mode: 'group' | 'step',
  ): void => {
    const { draftUndoRef, now, imageRefsFor } = getContext()


    const span = diffSpan(prev, next, prevCursor, nextCursor)
    // Backspace consumes the character BEFORE the caret; Delete consumes the
    // one AT it. The two directions anchor differently, so their runs must
    // never fold into one another.
    const backward = span.start < prevCursor
    const kind: DraftUndoEntry['kind'] =
      span.inserted.length > 0 ? 'insert' : backward ? 'deleteBackward' : 'deleteForward'
    const removed = prev.length - next.length
    const caretAfter = nextCursor
    if (mode === 'group') {
      const last = draftUndoRef.current[draftUndoRef.current.length - 1]
      // Continuity: this edit must begin where the last one ended. An insertion
      // begins at the caret; a Backspace consumes the character BEFORE it, so
      // the pre-edit caret is its start — comparing `span.start` there would
      // make every repeated Backspace a step of its own.
      const editStart = kind === 'insert' ? span.start : prevCursor
      if (
        last !== undefined &&
        last.caretAfter !== null &&
        last.kind === kind &&
        last.caretAfter === editStart &&
        now() - last.atMs <= UNDO_IDLE_MS &&
        // An insertion extends a word when its seam is not a boundary; a
        // deletion continues while it stays inside the word its run began in.
        // The boundary question is deliberately NOT asked of a deletion: at the
        // seam, `isDraftWordBoundary(prev, span.start)` reads the removed
        // character's LEFT neighbour, which stops the run one keystroke early
        // at a word's left edge and at the text head (and mis-splits a
        // re-segmented CJK suffix).
        (kind === 'insert'
          ? !isDraftWordBoundary(next, span.start)
          : extendDeleteRun(last, backward, removed))
      ) {
        last.atMs = now()
        last.caretAfter = caretAfter
        return
      }
    }
    pushDraftUndo(
      { text: prev, cursor: prevCursor, images: imageRefsFor(prev), block },
      kind,
      mode === 'group' ? caretAfter : null,
      // A sealed step never groups, so only a groupable deletion needs (and
      // pays for) the word interval.
      mode === 'group' && kind !== 'insert' ? startDeleteRun(prev, span.start, removed) : null,
    )
  }

const clearDraftUndoably = (): void => {
    const { syncImageGeneration, valueRef, cursorRef, imageRefsFor, foldBlockRef, discardDraftImages, setInput, setFileSelected } = getContext()


    syncImageGeneration()
    // Nothing to come back to on an already-empty draft: pushing a snapshot
    // there would waste the next Ctrl+Z (and hide an older real step).
    if (valueRef.current !== '') {
      pushDraftUndo(
        {
          text: valueRef.current,
          cursor: cursorRef.current,
          images: imageRefsFor(valueRef.current),
          block: foldBlockRef.current,
        },
        'clear',
        null,
      )
    }
    discardDraftImages({ keepUndo: true })
    setInput('', 0, 'silent')
    setFileSelected(0)
  }

const undoDraft = (): void => {
    const { syncImageGeneration, draftUndoRef, advanceDraftRevision, replaceDraftImages, updateFoldBlock, setInput, setFileSelected } = getContext()


    // A session replacement invalidates the whole stack. Check that BEFORE
    // popping: restoring first and discarding afterwards would put the old
    // session's text (and its image tokens) back into the new composer.
    syncImageGeneration()
    const entry = draftUndoRef.current.pop()
    if (entry === undefined) return
    advanceDraftRevision()
    replaceDraftImages(entry.images)
    // Drop the live block first: setInput's atomicity rules describe the block
    // that was live at edit time, and re-shifting it here would corrupt the
    // snapshot's. The snapshot's own block goes back afterwards, and only if
    // its range still fits the text it was captured from.
    updateFoldBlock(null)
    setInput(entry.text, entry.cursor, 'silent')
    const block =
      entry.block !== null && entry.block.start < entry.block.end && entry.block.end <= entry.text.length
        ? entry.block
        : null
    updateFoldBlock(block)
    setFileSelected(0)
  }
  return { clearDraftUndo, pushDraftUndo, recordDraftEdit, clearDraftUndoably, undoDraft }
}
