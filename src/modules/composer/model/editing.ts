


import type { ComposerImageRef } from '../../../shared/protocol/composer.js'


import { draftWordRangeAt } from '../../../shared/platform/draftWordBoundary.js'


import { getGraphemeSegmenter } from '../../../shared/platform/intl.js'


export interface PromptHistoryEntry {
  readonly text: string
  readonly images: readonly ComposerImageRef[]
}

export /**
 * One prompt-draft undo step: the state BEFORE a discrete edit (or edit run),
 * plus the tracking the grouping rule needs. `Ctrl+Z` pops it back, and it is
 * one of the places a staged image capability is held between edits, so it
 * must stay in {@link PromptInput}'s `stageIdIsRetained` scan.
 */
interface DraftUndoEntry extends PromptHistoryEntry {
  readonly cursor: number
  /** Fold block as it was before the step; restored (or cleared) with it. */
  readonly block: { readonly start: number; readonly end: number } | null
  /** Timestamp of the run's last edit (layer-3 idle coalescing). */
  atMs: number
  /** Caret the run's last edit ended at; `null` seals the step (discrete). */
  caretAfter: number | null
  /**
   * Edit direction, so a delete run never folds into an insert run and the two
   * deletion directions (whose anchors differ) never merge. `clear` marks the
   * sealed snapshot an Esc/clear takes, which never groups.
   */
  kind: 'insert' | 'deleteBackward' | 'deleteForward' | 'clear'
  /** Deletion runs only: see {@link DraftDeleteRun}. */
  deleteRun: DraftDeleteRun | null
}

export /**
 * The word a deletion run may keep consuming: the interval that held the first
 * character it removed, plus the range the run has consumed so far. Both are in
 * the step's own `text` coordinates, so the shrinking draft is never
 * re-segmented (a truncated copy can split a repeated-Han run differently).
 */
interface DraftDeleteRun {
  readonly wordStart: number
  readonly wordEnd: number
  /** Consumed range `[lo, hi)`. */
  lo: number
  hi: number
}

export /** Undo depth for draft edits. */
const UNDO_LIMIT = 100

export /** Total characters kept across all snapshots; the oldest are dropped first. */
const UNDO_MAX_CHARS = 1_000_000

export /** Layer-3 idle window: a pause longer than this starts a new step. */
const UNDO_IDLE_MS = 700

export /** How a `setInput` call relates to the draft undo stack. */
type UndoMode =
  /** Fold into the current step when the word/idle rules allow (typing). */
  | 'group'
  /** One discrete edit: its own step, sealed against continuation (paste). */
  | 'step'
  /** End of the draft's life: clear the stack, then apply the text. */
  | 'reset'
  /** Apply the text without touching the stack (undo itself, recalls). */
  | 'silent'

export /**
 * Common prefix/suffix of `prev` and `next` — the single edited span. Undo
 * grouping works on this span rather than on a stdin chunk: one chunk may
 * carry several characters (or several keys), so the unit is one real text
 * mutation however it arrived. The common prefix must not pass either caret:
 * repeated characters otherwise make an edit at the head look like a tail edit.
 */
function diffSpan(
  prev: string,
  next: string,
  cursorBefore: number,
  cursorAfter: number,
): { start: number; inserted: string } {
  let start = 0
  const common = Math.min(prev.length, next.length, cursorBefore, cursorAfter)
  while (start < common && prev.charCodeAt(start) === next.charCodeAt(start)) start++
  let prevEnd = prev.length
  let nextEnd = next.length
  while (
    prevEnd > start &&
    nextEnd > start &&
    prev.charCodeAt(prevEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    prevEnd--
    nextEnd--
  }
  return { start, inserted: next.slice(start, nextEnd) }
}

export /**
 * Open a deletion run at the first character it removed: remember the word that
 * character belongs to, and how much has been consumed so far.
 */
function startDeleteRun(text: string, start: number, removed: number): DraftDeleteRun {
  const word = draftWordRangeAt(text, start)
  return { wordStart: word.start, wordEnd: word.end, lo: start, hi: start + removed }
}

export /**
 * Whether a same-direction deletion extends the run recorded on `last`. The
 * run's word interval and consumed range live in `last.text` coordinates, so
 * the comparison survives the draft shrinking under it; extending past the word
 * (or off the text) starts a new step. Only called once the direction, caret
 * continuity and idle window have already agreed, so the new text is always
 * adjacent to the consumed range.
 */
function extendDeleteRun(last: DraftUndoEntry, backward: boolean, removed: number): boolean {
  const run = last.deleteRun
  if (run === null || removed <= 0) return false
  if (backward) {
    const lo = run.lo - removed
    if (lo < 0 || lo < run.wordStart) return false
    run.lo = lo
    return true
  }
  const hi = run.hi + removed
  if (hi > last.text.length || hi > run.wordEnd) return false
  run.hi = hi
  return true
}

export /** Index of the word boundary at or before `cursor` (readline alt+b). */
function wordBoundaryLeft(text: string, cursor: number): number {
  let index = cursor
  while (index > 0 && /\s/.test(text[index - 1]!)) index--
  while (index > 0 && !/\s/.test(text[index - 1]!)) index--
  return index
}

export /** Index of the word boundary after `cursor` (readline alt+f). */
function wordBoundaryRight(text: string, cursor: number): number {
  const length = text.length
  let index = cursor
  while (index < length && !/\s/.test(text[index]!)) index++
  while (index < length && /\s/.test(text[index]!)) index++
  return index
}

export // --- grapheme-cluster geometry ---------------------------------------------
// The caret, editing keys, and wrapping MUST agree on one text unit. Mixing
// UTF-16 code units (arrows/backspace), code points (wrap), and display
// cells (stringWidth) lets the caret land inside a surrogate pair or a ZWJ
// emoji — the inverted caret then shows half a glyph, Backspace deletes
// half a character, and `line.slice()` splits clusters. All offsets below
// are UTF-16 indices snapped to grapheme boundaries via the shared
// Intl.Segmenter (utils/intl.ts).

/** Ascending grapheme boundary offsets of `text` (starts at 0, ends at
 *  `text.length`). Empty text yields `[0]`. */
function graphemeBoundaries(text: string): number[] {
  const bounds = [0]
  for (const { index, segment } of getGraphemeSegmenter().segment(text)) {
    const end = index + segment.length
    if (end > bounds[bounds.length - 1]!) bounds.push(end)
  }
  return bounds
}

export /** Largest grapheme boundary `<= offset` (clamped into the text). Snaps a
 *  cursor that landed mid-cluster back onto a boundary. */
function boundaryAtOrBefore(bounds: number[], offset: number): number {
  let lo = 0
  let hi = bounds.length - 1
  let ans = bounds[0]!
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (bounds[mid]! <= offset) {
      ans = bounds[mid]!
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

export /** Largest grapheme boundary strictly before `offset` (0 when none). */
function previousGraphemeBoundary(bounds: number[], offset: number): number {
  let lo = 0
  let hi = bounds.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (bounds[mid]! < offset) {
      ans = bounds[mid]!
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

export /** Smallest grapheme boundary strictly after `offset` (text.length when
 *  none). Returns `offset` unchanged when it already is the last boundary. */
function nextGraphemeBoundary(bounds: number[], offset: number): number {
  let lo = 0
  let hi = bounds.length - 1
  let ans = bounds[hi] ?? 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (bounds[mid]! > offset) {
      ans = bounds[mid]!
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }
  return ans
}

export /** Snap an arbitrary UTF-16 offset onto a grapheme boundary of `text`,
 *  clamping into range. The safety net under every cursor write. */
function normalizeCursorOffset(text: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, text.length))
  return boundaryAtOrBefore(graphemeBoundaries(text), clamped)
}
