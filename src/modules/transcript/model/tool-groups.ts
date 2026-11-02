import type { ChatRow, ToolGroupRow } from '../../../shared/protocol/transcript.js'
import { isQuietTool } from '../../../shared/platform/tool-name.js'

/** Runs shorter than this stay card by card: each settled card is already one
 *  header line, so a summary for two of them saves nothing worth hiding. */
const TOOL_GROUP_FOLD_MIN = 3

function sameRun(a: ChatRow, b: ChatRow): boolean {
  if (a.kind !== 'tool' || b.kind !== 'tool' || a.tool === undefined || b.tool === undefined) return false
  if (!isQuietTool(a.tool, a.tool.resultView ?? a.tool.callView)) return false
  if (!isQuietTool(b.tool, b.tool.resultView ?? b.tool.callView)) return false
  return a.tool.name.toLowerCase() === b.tool.name.toLowerCase()
}

/**
 * Fold settled runs of ≥3 consecutive shell/job tool calls into one summary
 * row. Live runs stay expanded — their output is progress, and hiding it
 * would remove the only live surface. A failing run still folds: the summary
 * carries the red failure count, and click / Ctrl+O restores the cards.
 *
 * Returns the rewritten row array plus the ids of hidden members (the caller
 * filters those before virtualization).
 */
export function groupToolRuns(
  rows: readonly ChatRow[],
  expanded: boolean,
  expandedRows: ReadonlySet<number>,
): { rows: ChatRow[]; folded: Set<number> } {
  const out = rows.slice()
  const folded = new Set<number>()
  let index = 0
  while (index < out.length) {
    const head = out[index]!
    if (head.kind !== 'tool') { index++; continue }
    let end = index
    while (end + 1 < out.length && sameRun(out[end]!, out[end + 1]!)) end++
    const count = end - index + 1
    if (count < TOOL_GROUP_FOLD_MIN) { index = end + 1; continue }
    let running = false
    let failed = 0
    let startedAt = Number.POSITIVE_INFINITY
    let endedAt = 0
    for (let k = index; k <= end; k++) {
      const tool = out[k]!.tool!
      if (tool.status === 'running') running = true
      if (tool.status === 'error') failed++
      startedAt = Math.min(startedAt, tool.startedAt)
      endedAt = Math.max(endedAt, tool.startedAt + (tool.durationMs ?? 0))
    }
    // Live runs keep their cards: the summary would hide the output that is
    // still arriving.
    if (running) { index = end + 1; continue }
    const isFolded = !expanded && !expandedRows.has(head.id)
    const decoration: Omit<ToolGroupRow, 'head' | 'last'> = {
      count,
      folded: isFolded,
      failed,
      name: out[index]!.tool!.name,
      startedAt,
      endedAt,
    }
    for (let k = index; k <= end; k++) {
      out[k] = {
        ...(out[k]!),
        toolGroup: { ...decoration, head: k === index, last: k === end },
      }
    }
    if (isFolded) for (let k = index + 1; k <= end; k++) folded.add(out[k]!.id)
    index = end + 1
  }
  return { rows: out, folded }
}
