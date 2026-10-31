import type { ChatRow } from '../contracts/transcript-view.js'
import { markChannelReadDirty } from '../state/read-view.js'
import { preview } from './transcript.js'

/**
 * Fold the oldest rows beyond the transcript window cap: drop each row's
 * full-text fields (assistant/reasoning text, tool args/results) and keep
 * only its preview text, kind, id, and seq. Bounds the TUI's retained text
 * without touching the session log (the source of truth for /export and
 * loadOlder). Small local/notice/interrupt rows are left intact (they hold
 * terminal-local text the log cannot restore). Restored rows are exempt so
 * a loadOlder() restore is not instantly undone. Returns the number of rows
 * folded.
 */
export function foldRows(
  rows: ChatRow[],
  cap: number,
  cursor?: { rows: unknown; index: number; head?: unknown },
  /** Rows the backend can restore (default: every foldable kind); any
   *  other row keeps its full text. */
  restorable?: (row: ChatRow) => boolean,
): number {
  const excess = rows.length - cap
  if (excess <= 0) {
    if (cursor !== undefined) cursor.index = 0
    return 0
  }
  // Incremental pass: rows only ever append past the fold line and the
  // folded/restored exemptions are permanent, so everything below a cursor
  // over the SAME array identity needs no re-inspection. emit/emitStream
  // fold on every frame during streaming — a full rescan of a long window
  // there was the O(rows) per-frame term of long-session streaming. Rows
  // prepended ahead of the window (older history) shift every index: a new
  // head restarts the pass.
  const from = cursor === undefined ? 0 : cursor.rows === rows && cursor.head === rows[0] ? cursor.index : 0
  if (cursor !== undefined) {
    cursor.rows = rows
    cursor.head = rows[0]
  }
  if (excess <= from) return 0
  let folded = 0
  for (const row of rows.slice(from, excess)) {
    if (row.folded || row.restored) continue
    if (row.kind !== 'user' && row.kind !== 'assistant' && row.kind !== 'reasoning' && row.kind !== 'tool') continue
    if (restorable !== undefined && !restorable(row)) continue
    row.folded = true
    folded += 1
    if (row.kind === 'tool' && row.tool) {
      row.tool.argsFull = undefined
      row.tool.resultFull = undefined
      row.tool.errorText = undefined
      // Presentation views hold duplicated content strings (diff before/
      // after images, terminal output); the session log re-derives them.
      row.tool.callView = undefined
      row.tool.resultView = undefined
    } else if (row.text.length > 0) {
      // Keep a short preview so the transcript reads naturally; the full
      // text lives in the session log and is restored by loadOlder().
      row.text = preview(row.text, 200)
    }
    markChannelReadDirty(row)
    markChannelReadDirty(rows)
  }
  if (cursor !== undefined) cursor.index = excess
  return folded
}

export { MAX_ROWS } from './transcript.js'
