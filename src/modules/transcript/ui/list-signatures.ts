


import type { ChatRow } from '../../../shared/protocol/transcript.js'


import { normalizeIdePath } from '../../../shared/platform/ide-path.js'


import { stripNarration } from '../../../shared/platform/narration.js'
import { stringWidth } from '../../../shared/platform/stringWidth.js'


import { revealLengthOf, revealTextOf } from '../../../ui/streaming-reveal.js'


export function assistantRevealText(row: ChatRow, enabled: boolean): string {
  const stripped = stripNarration(row.text)
  return revealTextOf(`a${row.id}`, stripped, {
    enabled,
    active: row.streaming === true || row.fresh === true,
  })
}

export function reasoningRevealText(row: ChatRow, enabled: boolean): string {
  return revealTextOf(`r${row.id}`, row.text, { enabled, active: row.streaming === true })
}

export function revealDisplayLen(row: ChatRow, enabled: boolean): number {
  if (row.kind === 'assistant') {
    const stripped = stripNarration(row.text)
    return revealLengthOf(`a${row.id}`, stripped, {
      enabled,
      active: row.streaming === true || row.fresh === true,
    })
  }
  if (row.kind === 'reasoning') {
    return revealLengthOf(`r${row.id}`, row.text, { enabled, active: row.streaming === true })
  }
  return row.text.length
}

export function displaySelectionPath(
  path: string,
  sessionCwd: string | undefined,
  caseInsensitive: boolean = process.platform === 'win32' || process.platform === 'darwin',
): string {
  if (sessionCwd === undefined || sessionCwd === '') return path
  // Shared normalizer (lock matching uses the same): backslashes fold to
  // forward slashes, trailing slashes stripped — transforms that preserve
  // character positions, so slicing the canonical path at the cwd's length
  // keeps the file's own casing in the displayed relative string. Folding
  // decides only WHETHER the prefix matches, never what gets sliced off.
  const pathNorm = normalizeIdePath(path, false)
  const cwdNorm = normalizeIdePath(sessionCwd, false)
  if (cwdNorm === '' || cwdNorm.length >= pathNorm.length) return path
  // The POSIX root `/` is a prefix of every absolute path without a further
  // separator — `/repo/file.ts` under cwd `/` displays as `repo/file.ts`.
  // (A `startsWith('/' + '/')` check would never match; coderabbit review.)
  if (cwdNorm === '/') {
    return pathNorm.startsWith('/') ? pathNorm.slice(1) : path
  }
  const foldedPath = normalizeIdePath(pathNorm, caseInsensitive)
  const foldedCwd = normalizeIdePath(cwdNorm, caseInsensitive)
  if (!foldedPath.startsWith(`${foldedCwd}/`)) return path
  return pathNorm.slice(cwdNorm.length + 1)
}

export const signatureScratch: Array<string | number | boolean> = []

export function jobStatusCode(status: string): number {
  switch (status) {
    case 'running': return 1
    case 'stopping': return 2
    case 'completed': return 3
    case 'failed': return 4
    case 'killed': return 5
    default: return 7
  }
}

export function signatureParts(
  row: ChatRow,
  columns: number,
  expanded: boolean,
  expandedRows: ReadonlySet<number>,
  expandedDetails: ReadonlySet<number>,
  streamViewToggledRows: ReadonlySet<number>,
  thinkingVisible: boolean,
  thinkingFold: string,
  diffLayout: string,
  model: string,
  failureHintRowId: number | null | undefined,
  failureHint: string | undefined,
  displayTextLen: number,
  sessionCwd: string | undefined,
): Array<string | number | boolean> {
  signatureScratch.length = 0
  // Universal height inputs: width reflows every row; kind switches height
  // semantics wholesale; text length drives wrapping. `displayTextLen` is the
  // REVEALED length while smooth streaming is painting (the height follows
  // what is on screen, not what has arrived).
  signatureScratch.push(columns, row.kind, displayTextLen)
  const images = row.images
  signatureScratch.push(images?.length ?? 0)
  if (images?.length === 1) {
    signatureScratch.push(images[0]!.width, images[0]!.height)
  }
  switch (row.kind) {
    case 'assistant':
      // Streaming vs settled swaps renderers; Ctrl+O/per-row expand adds the
      // metadata row (model only renders expanded — keeps an idle /model
      // switch from touching settled rows).
      signatureScratch.push(row.streaming === true, expanded, expandedRows.has(row.id), expanded ? model : '')
      break
    case 'reasoning':
      // thinkingFold (preview vs full), its per-row live override, and the
      // visibility filter all change the card's height.
      signatureScratch.push(row.streaming === true, row.thinkingOpen === true, expanded, expandedRows.has(row.id), streamViewToggledRows.has(row.id), thinkingVisible, thinkingFold)
      break
    case 'tool': {
      const tool = row.tool
      const group = row.toolGroup
      signatureScratch.push(
        expanded,
        // expandedRows folds an open tool group; expandedDetails opens the
        // individual card body (the compact card is one header line at rest).
        expandedRows.has(row.id),
        expandedDetails.has(row.id),
        diffLayout,
        tool?.status ?? '',
        tool?.resultText?.length ?? 0,
        tool?.resultFull?.length ?? 0,
        tool?.errorText?.length ?? 0,
        // Source-fold disclosure and the uncapped terminal exit/signal tail
        // change the card's height when they (dis)appear — the window fold
        // drops payloads and a settled terminal view adds its verdict lines.
        row.folded === true,
        tool?.resultView?.card ?? '',
        row.id === failureHintRowId ? failureHint ?? '' : '',
        // A group head swaps its card for the summary line when folded.
        group !== undefined,
        group?.head === true,
        group?.folded === true,
        group?.count ?? 0,
        group?.failed ?? 0,
      )
      break
    }
    case 'subagent':
      // 卡片高度输入：running→settled 折叠 waterfall+tool 行（5→1 行），
      // failed 增加 error 行。缺这些字段的话 offscreen 结算后 cached
      // height 永不过期 → 滚回 blank band / 滚不到底。
      signatureScratch.push(
        row.subagent?.status ?? '',
        row.subagent?.toolCalls.length ?? 0,
        row.subagent?.outputLines.length ?? 0,
        row.subagent?.error?.length ?? 0,
      )
      break
    case 'job': {
      // Command expansion and group folding change the row height; output
      // stays within a fixed two-row tail, independent of command expansion.
      const group = row.jobGroup
      signatureScratch.push(
        expanded,
        expandedRows.has(row.id),
        expandedDetails.has(row.id),
        row.job?.status ?? '',
        // Script text, including blank-line changes, determines expanded height.
        row.job?.label ?? '',
        row.job?.outputLines.length ?? 0,
        row.job?.detail?.length ?? 0,
        row.job?.progress?.length ?? 0,
        // The waterfall wraps its tail and keeps the last rows, so how much
        // text those tail lines carry decides how many rows actually paint.
        row.job === undefined
          ? ''
          : row.job.outputLines.slice(-2).map(line => `${line.text.length}:${line.gapBefore === true}`).join(','),
        // The group head adds a summary; folded groups hide their card bodies.
        group !== undefined,
        group?.head === true,
        group?.folded === true,
      )
      break
    }
    case 'compact':
      // Folded one-liner vs full summary text.
      signatureScratch.push(expanded, expandedRows.has(row.id))
      break
    case 'turn-summary':
      // Immutable payload, single truncate-end line: the kind switch alone
      // covers the height semantics (content never changes after creation).
      break
    case 'user':
      // T06: the selection indicator line above the bubble adds one rendered
      // row whose text wraps with width — its presence and content length
      // are height inputs. Missing this would leave offscreen spacer heights
      // stale when the field arrives (scroll jump, DESIGN R4).
      // T-FIX-01: the indicator renders the cwd-relative display path, so
      // the signature hashes THAT string — a cwd switch (/workspace) that
      // changes the display form must invalidate the cached height too.
      // width is the display-CELL width (emoji / CJK / combining / ANSI
      // differ from JS length), not the JS string length — two paths with
      // equal length but different terminal widths must not share a cached
      // height (coderabbit review, repo width convention).
      signatureScratch.push(
        row.selectionAttached === undefined ? 0 : 1,
        stringWidth(displaySelectionPath(row.selectionAttached?.path ?? '', sessionCwd)),
        String(row.selectionAttached?.lines ?? ''),
      )
      // Long-line fold: expanding a folded row swaps the folded preview for
      // the raw line (thousands of rows), so both expansion switches are
      // height inputs on user rows too — same rationale as the default arm.
      signatureScratch.push(expanded, expandedRows.has(row.id))
      break
    default:
      // notice / interrupt / local / local-output: height follows
      // text + columns alone (selection/background never change height) —
      // EXCEPT the long-line fold: expanding a folded row swaps ~10 rows of
      // folded text for the raw line (thousands), so both expansion switches
      // are height inputs here too. Without them the stale cached height
      // feeds topPad/bottomPad and the offsets scan, and the expanded tail
      // can end up unreachable behind a wrong scroll range.
      signatureScratch.push(expanded, expandedRows.has(row.id))
      break
  }
  return signatureScratch
}
