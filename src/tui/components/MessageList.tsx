import React, { useState } from 'react'
import type { TranscriptImage } from '../../app/contracts/composer-view.js'
import type { JobGroupRow, JobRow } from '../../app/contracts/job-view.js'
import type { SubagentRow } from '../../app/contracts/subagent-view.js'
import type { ChatRow, ToolCallView, ToolResultView, ToolRow } from '../../app/contracts/transcript-view.js'
import { t } from '../../app/i18n.js'
import type { JobGroupFoldMode, ToolBackground } from '../../app/preferences/tuiDisplayPrefs.js'
import { normalizeIdePath } from '../../app/session/ide-path.js'
import type { DOMElement } from '../../ink/dom.js'
import type { ClickEvent } from '../../ink/events/click-event.js'
import { getTerminalFlushTick } from '../../ink/flush-tick.js'
import { noteFrameCause, noteListGeometry } from '../../ink/geometry-trace.js'
import { truncateToWidth } from '../../ink/truncateToWidth.js'
import { foldLongLines } from '../../utils/fold-long-lines.js'
import { primaryComboString } from '../../utils/keymap.js'
import { stripNarration } from '../../utils/narration.js'
import { stringWidth } from '../../utils/stringWidth.js'
import { useRevealVersion } from '../hooks/useRevealVersion.js'
import { Box, Text, useTerminalSize } from '../primitives.js'
import { JobCard } from './Chat/JobCard.js'
import { JobGroupHeader } from './Chat/JobGroupHeader.js'
import { SubagentMessage } from './Chat/SubagentMessage.js'
import { StreamingMarkdown } from './StreamingMarkdown.js'
import { TurnInterruptedRow } from './TurnInterruptedRow.js'
import { Divider } from './design-system/Divider.js'
import { MessageMetadata } from './messages/MessageMetadata.js'
import { TranscriptImages } from './messages/TranscriptImages.js'
import { AssistantTextLeafRow, ThinkingLeafRow, ToolLeafRow } from './messages/TranscriptLeaves.js'
import { UserPromptMessage } from './messages/UserPromptMessage.js'
import { getRevealVersion, revealLengthOf, revealTextOf } from './smoothReveal.js'

/**
 * Transcript rows rendered with the dsh-TUI message layout: user prompts
 * on a grey bubble with a `❯` pointer, assistant text with a `●` bullet and
 * markdown, thinking as a live three-line/full toggle then a settled
 * `⚓ Thinking` row with the localized ctrl+o expand hint, and tool calls as
 * status-dot cards.
 * `expanded` (Ctrl+O) shows full reasoning + full tool
 * args/results; `expandedRows` (message-selection mode, Enter) expands single
 * rows; `selectedId` highlights the selected row.
 */
/** Render cap for very long sessions: older rows fold behind a Divider until
 *  Ctrl+E expands them.
 *  120 (was 300): opening a long session paints the whole cap into the
 *  main-screen scrollback (historyPaint), and each row's first markdown
 *  lex + wrap costs ~2-5ms — 300 rows saturated the main thread for ~6s
 *  on open (measured, 800-row inline session). 120 rows ≈ 4-5 screens of
 *  paint (<1s) with the rest behind the show-previous divider. The transcript
 *  is a viewport, not a printout; load-earlier restores older rows. */
const RENDERED_ROW_CAP = 120

/** Threshold of the `auto` jobGroupFold policy: a run of this many (or
 *  more) FULLY SETTLED jobs folds into its own summary line. Two jobs are
 *  still a pair worth reading card by card — the group rail alone already
 *  saves their separator lines there. `always` uses 2, `never` uses none.
 *  Ctrl+O and a click on the summary reopen any group; clicking again folds
 *  it back. */
const JOB_GROUP_FOLD_MIN = 3

// --- layout virtualization constants -------------------------------------
// Offscreen rows render as fixed-height spacers whose heights come from the
// previous commit's Yoga layout, so the pure-JS Yoga engine never walks
// their subtrees. Spacers preserve the scroll geometry (content height,
// terminal scrollback) of a fully-mounted list.
/** Lines of extra content mounted above/below the visible window. */
const OVERSCAN_LINES = 8
/** Fallback row height before the first measurement (terminal lines). */
const DEFAULT_ROW_HEIGHT = 2
/** Cold-start estimate of the header block above the rows; corrected by the
 *  first layout measurement. */
const DEFAULT_HEADER_LINES = 14
/** Stable fallbacks for the stream-view toggle props: verify/repro harnesses
 *  and embedders render MessageList with prop sets that predate them, and the
 *  render must not throw (same rule as Chat's stubbed channel APIs). Module
 *  scope keeps the identities stable so MemoRow's shallow compare and the
 *  toggle callback's deps never churn. */
const NO_STREAM_VIEW_TOGGLED: ReadonlySet<number> = new Set()
const NOOP_TOGGLE_STREAM_VIEW = (_rowId: number): void => {}

// --- smooth-streaming display text -----------------------------------------
// Render-phase reads of the shared reveal cursors (see smoothReveal.ts for
// why the cursors live outside React). `active` gates cursor CREATION to
// live-arrived content (streaming rows, live-settled rows marked `fresh`,
// replayed history paints complete); once created, a cursor keeps revealing
// until it catches up — settling mid-reveal must not snap (that is the
// "non-streaming delivery becomes a smooth flow" contract).

function assistantRevealText(row: ChatRow, enabled: boolean): string {
  const stripped = stripNarration(row.text)
  return revealTextOf(`a${row.id}`, stripped, {
    enabled,
    active: row.streaming === true || row.fresh === true,
  })
}

function reasoningRevealText(row: ChatRow, enabled: boolean): string {
  return revealTextOf(`r${row.id}`, row.text, { enabled, active: row.streaming === true })
}

/** Display length only (layout signature; no slice allocation). */
function revealDisplayLen(row: ChatRow, enabled: boolean): number {
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

/**
 * Display form of an IDE-selection path (T-FIX-01): when the path lives
 * under the session cwd, strip that prefix so the indicator line reads
 * `src/a.ts` instead of a long absolute path (UAT finding — the extension
 * anchors at its workspace root while the TUI session cwd is the git
 * worktree root, so raw paths are long and redundant). Pure display layer:
 * the `<attached-file>` block keeps its absolute path for the model.
 *
 * Comparison reuses normalizeIdePath (the ide-channel lock matcher's
 * normalizer: backslashes folded to forward slashes, trailing slashes
 * stripped, case folded on case-insensitive filesystems) so Windows forms
 * like `d:/x` vs `D:\X` still match. Prefix hits return the remainder
 * (`src/a.ts`); everything else — outside cwd, empty/undefined cwd, or the
 * path being the cwd itself — returns the input unchanged. NOT basename:
 * that would drop the directory context and collide on same-named files.
 * `caseInsensitive` is parameterized so verifiers can pin either mode on
 * any host.
 */
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

/**
 * Per-kind layout signature PARTS: the O(1) identity of every input that
 * decides a row's rendered HEIGHT (see sigRef in MessageList). Fields are
 * scoped to the row's own renderer — a global flat signature
 * over-invalidates (a diffLayout switch must not drop user-message
 * heights). Text uses length as the proxy: full-text hashing per row per
 * frame would defeat virtualization's budget, and a same-length miss only
 * degrades to the previous behavior.
 *
 * Returns a PARTS VECTOR instead of a joined string: the caller compares
 * slot-by-slot against the cached vector (all primitives), allocating only
 * when a row's inputs actually changed. Building a joined string per row
 * per render was O(rows) allocation churn on every scroll tick — the GC
 * share of the long-session scroll profile.
 *
 * The vector is a MODULE-LEVEL SCRATCH BUFFER: single-threaded synchronous
 * render makes reuse safe, and the unchanged case (the overwhelming
 * majority) allocates nothing. Callers that retain the vector must copy
 * (parts.slice()).
 */
const signatureScratch: Array<string | number | boolean> = []

/** Status code for the job-group fingerprint (a hash input only — the values
 *  just have to be distinct per status). */
function jobStatusCode(status: string): number {
  switch (status) {
    case 'running': return 1
    case 'stopping': return 2
    case 'completed': return 3
    case 'failed': return 4
    case 'killed': return 5
    default: return 7
  }
}

function signatureParts(
  row: ChatRow,
  columns: number,
  expanded: boolean,
  expandedRows: ReadonlySet<number>,
  streamViewToggledRows: ReadonlySet<number>,
  thinkingVisible: boolean,
  thinkingFold: string,
  diffLayout: string,
  foldTerminalCommand: boolean,
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
      signatureScratch.push(
        expanded,
        expandedRows.has(row.id),
        diffLayout,
        // Terminal header folding changes the header's height the same way
        // diffLayout changes the body's — without it, a /settings toggle
        // leaves already-mounted tool cards at their stale cached height.
        foldTerminalCommand,
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

export function MessageList({
  rows,
  expanded,
  expandedRows,
  selectedId,
  onToggleRow,
  streamViewToggledRows = NO_STREAM_VIEW_TOGGLED,
  onToggleStreamView = NOOP_TOGGLE_STREAM_VIEW,
  model,
  diffLayout = 'auto',
  thinkingFold = 'preview',
  jobGroupFold = 'auto',
  toolBackground = 'none',
  foldTerminalCommand = false,
  smoothStreaming = false,
  showAll,
  onToggleAll,
  onLoadOlder,
  olderHistory,
  thinkingVisible = true,
  failureHintRowId,
  failureHint,
  onOpenSubagent,
  onOpenSubagentView,
  onOpenJobs,
  onWatchJobOutput,
  onOpenFile,
  sessionCwd,
}: {
  rows: readonly ChatRow[]
  expanded: boolean
  expandedRows: ReadonlySet<number>
  selectedId: number | null
  onToggleRow: (rowId: number) => void
  /** 流式 reasoning 行相对 thinkingFold 默认视图的逐行切换。 */
  streamViewToggledRows?: ReadonlySet<number>
  onToggleStreamView?: (rowId: number) => void
  model: string
  /** Edit/Write diff presentation preference (forwarded to tool cards). */
  diffLayout?: 'auto' | 'split' | 'unified'
  /** Thinking-block display mode from channel (`preview`/`full`). */
  thinkingFold?: 'preview' | 'full'
  /** Grouping/folding of consecutive job-card runs (settings
   *  `dsh-tui.jobGroupFold`): `auto` folds a settled run of ≥3 into its
   *  summary header, `always` folds any run of ≥2, `never` leaves runs open
   *  (a header click still folds one by hand). */
  jobGroupFold?: JobGroupFoldMode
  /** Tool-card background treatment from the live channel settings. */
  toolBackground?: ToolBackground
  /** Terminal-card header folding from the live channel settings. */
  foldTerminalCommand?: boolean
  /** Smooth streaming reveal from the live channel settings (default off at
   *  this layer — embedders and verify harnesses keep exact-paint behavior;
   *  Chat passes the channel's `dsh-tui.smoothStreaming` value). */
  smoothStreaming?: boolean
  showAll: boolean
  onToggleAll: () => void
  /** Restore folded-away older rows from the session log; shown only when
   *  rows were folded (or `olderHistory` says more exists before them). */
  onLoadOlder?: () => void
  /** The session has history older than the first row (a compaction cut it
   *  off before a resume): the "load earlier" divider shows without any
   *  folded row. */
  olderHistory?: boolean
  /** A job card on screen keeps its output tail fresh (returns the unwatch). */
  onWatchJobOutput?: (id: string) => () => void
  thinkingVisible?: boolean
  /**
   * Row id that should carry the trajectory footnote — the newest unseen
   * failure, or null. Exactly one row ever carries it: repeating the pointer
   * under every historical failure is the clutter this design avoids.
   */
  failureHintRowId?: number | null
  /** Footnote text, e.g. `ctrl+t for the full trajectory`. */
  failureHint?: string
  /** 打开子代理详情场景（transcript 内点击子代理卡）。 */
  onOpenSubagent?: (agentId: string) => void
  /** 从转录里的子代理卡打开主屏只读 Agent View。 */
  onOpenSubagentView?: (agentId: string, rowId: number) => void
  /** 打开 /jobs 后台任务面板（transcript 内点击任务卡）。 */
  onOpenJobs?: (focusId?: string) => void
  /** 点击工具卡内的文件路径（打开文件操作菜单）。 */
  onOpenFile?: (path: string) => void
  /** Session working directory (fs path, `channel.cwd`): the IDE-selection
   *  indicator line strips this prefix for display (T-FIX-01). Optional —
   *  repro/verify harnesses that predate the field render unchanged with
   *  raw paths. The real fs cwd, NOT displayCwd: remote URI display forms
   *  can't prefix-match selection paths. */
  sessionCwd?: string | undefined
}) {
  const hiddenCount = rows.length - RENDERED_ROW_CAP
  // The thinking filter runs BEFORE virtualization so window indices line up.
  //
  // Fingerprint memo: every scroll tick re-rendered this pipeline even when
  // nothing changed — slice + filter allocate a fresh rows-length array and
  // the margins pre-pass allocates a Map with one entry per row (3200-row
  // session ⇒ ~200KB churn per 16ms tick, the GC share of the scroll
  // profile). The inputs are all identity-stable across ticks: channel.rows
  // is a live in-place array (identity changes only on rewind/new session),
  // showAll/thinkingVisible are React state. Rows APPENDED in place keep the
  // identity — the cache must key on rows.length too (streaming appends).
  const visibleRowsCacheRef = React.useRef<{
    rows: readonly ChatRow[]
    rowsLength: number
    showAll: boolean
    thinkingVisible: boolean
    out: readonly ChatRow[]
    margins: ReadonlyMap<number, boolean>
    /** Per-row `streaming === true` bits. The settle flip (streaming cleared
     * in place, rows identity/length unchanged) changes empty-assistant
     * filtering below, so the cache must rebuild on any bit change. */
    streamBits: Uint8Array
    /** Job-status/toggle fingerprint (see below): job cards settle IN PLACE,
     *  and a settling run changes how — and whether — its members render. */
    jobsSig: number
  } | null>(null)
  const visibleCache = visibleRowsCacheRef.current
  // Streaming-bit fingerprint: in-place `streaming = false` writes (turn
  // settle) are invisible to the rows-identity/length key above, but an
  // assistant row that settles with EMPTY text crosses the empty-assistant
  // filter boundary (visible-while-streaming → filtered-when-settled).
  // Allocation-free scan; rebuild only when a bit actually flipped.
  let streamBitsSame = visibleCache !== null && visibleCache.streamBits.length === rows.length
  if (streamBitsSame) {
    const bits = visibleCache!.streamBits
    for (let i = 0; i < rows.length; i++) {
      if (bits[i] !== (rows[i]!.streaming === true ? 1 : 0)) { streamBitsSame = false; break }
    }
  }
  // Job-group fingerprint: job statuses land IN PLACE (`row.job` is
  // re-assigned by the projection, the row array never moves) and the expand
  // toggles live in a Set — none of that shows up in the rows identity or
  // length key above, yet both decide whether a consecutive-job run folds,
  // and a folded run REMOVES its members from the visible window. One
  // allocation-free pass over the row list (only job rows feed the hash).
  let jobsSig = (expanded ? 1 : 0) * 7 + (jobGroupFold === 'always' ? 1 : jobGroupFold === 'never' ? 2 : 3)
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (row.kind !== 'job' || row.job === undefined) continue
    jobsSig = (jobsSig * 33 + row.id + jobStatusCode(row.job.status) + (expandedRows.has(row.id) ? 7 : 0)) | 0
  }
  if (
    visibleCache === null ||
    visibleCache.rows !== rows ||
    visibleCache.rowsLength !== rows.length ||
    visibleCache.showAll !== (showAll || hiddenCount <= 0) ||
    visibleCache.thinkingVisible !== thinkingVisible ||
    visibleCache.jobsSig !== jobsSig ||
    !streamBitsSame
  ) {
    const sliced = showAll || hiddenCount <= 0
      ? rows
      : rows.slice(hiddenCount)
    // Empty settled assistant rows (PR #383's duplicate-dot bug): when the
    // model calls a tool without producing text, the assistant/message event
    // carries empty text — rendered as a lone `●` bullet dangling above the
    // tool card. Filter them BEFORE virtualization (not by rendering null in
    // TranscriptRow): a null row never mounts, never enters paintedOnce, and
    // would stall the main-screen history-paint batch loop forever. A row
    // that is STILL STREAMING keeps its place even with empty text — the
    // live dot is the "model is answering" affordance and content may yet
    // arrive.
    // The emptiness test must match what RENDERING shows: the `⏵`
    // self-narration line (dsh-working-activity narrate contract) is
    // stripped at render (stripNarration below), so a narration-only step —
    // thinking, `⏵ …` line, straight to a tool call — has non-empty raw
    // text but RENDERS as that same lone `●`. Test the stripped text, or
    // the raw-text check lets the dot through forever.
    const rendersEmptyAssistant = (row: ChatRow): boolean =>
      row.kind === 'assistant' &&
      row.streaming !== true &&
      stripNarration(row.text ?? '').trim() === '' &&
      (row.images?.length ?? 0) === 0
    let hasEmptyAssistant = false
    for (const row of sliced) {
      if (rendersEmptyAssistant(row)) {
        hasEmptyAssistant = true
        break
      }
    }
    // The transcript can arrive FROZEN end to end: the session projection
    // freezes both the row array and every row object (session-projection.ts
    // `Object.freeze(rows.map(row => Object.freeze({ ...row })))`), so the
    // pass-through branch below must COPY rather than alias it. The group
    // decoration further down is render-local derived state: it rides
    // shallow copies inside this writable array, never the shared row
    // objects (an in-place write throws on a frozen row and takes the TUI
    // down at startup — the resume/replay first frame delivers exactly
    // that shape).
    let out: ChatRow[] = hasEmptyAssistant
      ? sliced.filter(row =>
          !rendersEmptyAssistant(row) &&
          (thinkingVisible || row.kind !== 'reasoning'),
        )
      : thinkingVisible
        ? sliced.slice()
        : sliced.filter(row => row.kind !== 'reasoning')
    out = out.filter(row => row.kind !== 'turn-summary')
    // --- consecutive-job groups ------------------------------------------
    // A batch of run_in_background calls lands as N adjacent job cards (the
    // projection pushes the whole roster in one sync) and EVERY card pays
    // the 1-row block margin — a pile of near-identical rows for work nobody
    // reads card by card. Read ≥2 adjacent job rows as ONE group instead:
    // members drop the blank line between them, hang off a shared chain
    // rail, and the head row carries the run summary. A fully settled run
    // (≥ JOB_GROUP_FOLD_MIN) folds into that summary alone.
    //
    // Folded members are removed HERE, before virtualization, so window
    // indices line up (same rule as the thinking filter). The fold is the
    // ordinary per-row expand gesture: clicking the summary — or Ctrl+O —
    // reopens the run, clicking again folds it back.
    //
    // Runs are detected in the VISIBLE list, so a run whose head fell behind
    // the RENDERED_ROW_CAP fold window is read from the first visible member
    // (the header then counts what is on screen — never a headerless rail).
    const foldedMembers = new Set<number>()
    for (let i = 0; i < out.length; i++) {
      const head = out[i]!
      if (head.kind !== 'job' || head.job === undefined) continue
      let end = i
      while (end + 1 < out.length) {
        const next = out[end + 1]!
        if (next.kind !== 'job' || next.job === undefined) break
        end++
      }
      const count = end - i + 1
      if (count < 2) {
        // A lone card renders exactly as it did before groups existed (no
        // rail, its own block margin). Nothing to clear: the decoration
        // lives on per-pass shallow copies, never on the shared rows.
        i = end
        continue
      }
      let running = 0
      let completed = 0
      let failed = 0
      let killed = 0
      let startedAt = Number.POSITIVE_INFINITY
      let endedAt: number | undefined
      for (let k = i; k <= end; k++) {
        const job = out[k]!.job!
        switch (job.status) {
          case 'running':
          case 'stopping':
            running++
            break
          case 'completed':
            completed++
            break
          case 'killed':
            killed++
            break
          default:
            failed++
        }
        startedAt = Math.min(startedAt, job.startedAt)
        if (job.finishedAt !== undefined) endedAt = Math.max(endedAt ?? job.finishedAt, job.finishedAt)
      }
      // A live member means the run is not over: no duration to freeze.
      if (running > 0) endedAt = undefined
      // Fold policy (settings `dsh-tui.jobGroupFold`): `auto` waits for the
      // whole run to settle, `always` folds a run of 2+ immediately (live
      // members included — the header still reports what is running), and
      // `never` leaves the decision to a header click. Ctrl+O force-expands
      // every run; the header click lands in expandedRows.
      const foldMin = jobGroupFold === 'always' ? 2 : JOB_GROUP_FOLD_MIN
      const folded = jobGroupFold !== 'never' && count >= foldMin &&
        (jobGroupFold === 'always' || running === 0) && !expanded && !expandedRows.has(head.id)
      for (let k = i; k <= end; k++) {
        // Copy-on-write: decorate a shallow copy. `out[k].jobGroup = …` in
        // place throws on the frozen rows the session projection delivers
        // (resume/replay), crashing the TUI at startup.
        out[k] = {
          ...(out[k]!),
          jobGroup: {
            head: k === i,
            last: k === end,
            count,
            folded,
            running,
            completed,
            failed,
            killed,
            startedAt,
            ...(endedAt === undefined ? {} : { endedAt }),
          },
        }
      }
      if (folded) {
        for (let k = i + 1; k <= end; k++) foldedMembers.add(out[k]!.id)
      }
      i = end
    }
    const visibleOut = foldedMembers.size === 0 ? out : out.filter(row => !foldedMembers.has(row.id))
    // Every rendered block gets a 1-row top margin except the first. Pre-pass
    // over the FULL list so a windowed row keeps the exact spacing it would
    // have in a fully-mounted list. Group members are the exception: they sit
    // flush under their head, which is the separator line the group removes.
    const margins = new Map<number, boolean>()
    {
      let prev: ChatRow['kind'] | undefined
      for (const row of visibleOut) {
        const member = row.jobGroup !== undefined && !row.jobGroup.head
        margins.set(row.id, prev !== undefined && !member)
        prev = row.kind
      }
    }
    const streamBits = new Uint8Array(rows.length)
    for (let i = 0; i < rows.length; i++) streamBits[i] = rows[i]!.streaming === true ? 1 : 0
    visibleRowsCacheRef.current = {
      rows,
      rowsLength: rows.length,
      showAll: showAll || hiddenCount <= 0,
      thinkingVisible,
      out: visibleOut,
      margins,
      streamBits,
      jobsSig,
    }
  }
  const visibleRows = visibleRowsCacheRef.current!.out
  const margins = visibleRowsCacheRef.current!.margins
  // Selection keeps its highlight; expanded rows render with no fill (the
  // diff line tints inside cards are the only backgrounds in the transcript).
  const rowBackground = (rowId: number) => {
    const isSelected = selectedId === rowId
    if (isSelected) return 'messageActionsBackground'
    return undefined
  }

  // --- layout virtualization ---------------------------------------------
  const { columns, rows: termRows } = useTerminalSize()
  // Smooth-reveal wakeups: the scheduler's tick bumps this hook, re-running
  // MessageList so the revealed `text`/line-count reads below feed fresh
  // values through the same MemoRow-prop pipeline an arriving chunk uses —
  // memo miss → re-render → post-commit height re-measure. Without this
  // subscription a reveal living in child state would change row heights
  // invisibly to the virtualization (stale cached heights → blank bands).
  // DefaultLane on purpose (useRevealVersion): a useSyncExternalStore wakeup
  // would force a SyncLane render per 33ms tick, and each such commit ending
  // with streaming work still pending feeds React's nested-update counter
  // until error #185 kills the process (beta.3).
  useRevealVersion()
  // Measured row heights, remembered after a row unmounts so virtualization
  // can preserve total content height. Bounded: row ids grow monotonically
  // and rows are never removed from the transcript (foldRows keeps the
  // row), so without a cap this Map grew by one entry per row forever.
  // Eviction is FIFO (oldest row first); a forgotten height falls back to
  // DEFAULT_ROW_HEIGHT, which only perturbs deep scrollback estimates.
  const HEIGHTS_CACHE_MAX = 5000
  const heightsRef = React.useRef(new Map<number, number>())
  const localRefs = React.useRef(new Map<number, DOMElement>())
  /** Row ids that have been mounted (and therefore painted into the
   *  terminal) at least once. The sticky window may skip a row ONLY after
   *  this: an unpainted row above the window has no scrollback copy, so
   *  skipping it would erase it from the user's history entirely — preset
   *  history at boot (session resume) landed exactly there. Cleared when
   *  the list head changes identity (rewind / new session / loadOlder
   *  prepends restored rows that must paint again). */
  const paintedOnceRef = React.useRef<Set<number>>(new Set())
  const paintedBaseRef = React.useRef<number | undefined>(undefined)
  /** Window-expansion hold: after the window WIDENS (new rows mounted),
   *  refuse to tighten until a frame containing that layout has actually
   *  been FLUSHED to the terminal (flush-tick based, issue #574). React
   *  commits and terminal writes are decoupled — the throttled deferred
   *  leading edge lets a later commit supersede the wide one inside the
   *  same task, so a wall-clock hold (the old 120ms timer) expires during
   *  long cold-cache layout work (~190ms on the repro) and the measure-tick
   *  re-render still drops the rows before a single byte of them was
   *  written; never-mounted rows have no scrollback copy and preset history
   *  vanishes. Once flushed, tightening is visually free: those rows sit in
   *  scrollback and the diff skips them. */
  const lastStartRef = React.useRef<number>(-1)
  const holdFlushTickRef = React.useRef<number>(-1)
  /** True when frame-budgeted history painting still has batches left
   *  (main-screen open): the layout effect schedules the next slice. */
  const paintPendingRef = React.useRef(false)
  const paintTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Persistent history-paint edge: how far batched painting has advanced
   *  (index into visibleRows). -1 = not painting / reset (list head change:
   *  rewind, new session, loadOlder — must repaint from scratch). */
  const paintEdgeRef = React.useRef(-1)
  const listHeadId = visibleRows[0]?.id
  if (listHeadId !== undefined && paintedBaseRef.current !== undefined && listHeadId !== paintedBaseRef.current) {
    paintedOnceRef.current = new Set()
    // History repaints from scratch after a head change too (rewind /
    // loadOlder prepends rows that must paint again).
    paintEdgeRef.current = -1
  }
  if (listHeadId !== undefined) paintedBaseRef.current = listHeadId
  /** Content-space offset of visibleRows[0] (header + dividers), measured. */
  const baseRef = React.useRef<number | null>(null)
  const measureTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, setMeasureTick] = React.useState(0)
  React.useEffect(() => () => {
    if (measureTimerRef.current !== null) {
      clearTimeout(measureTimerRef.current)
      measureTimerRef.current = null
    }
    if (paintTimerRef.current !== null) {
      clearTimeout(paintTimerRef.current)
      paintTimerRef.current = null
    }
  }, [])

  // A width change reflows every row — all measurements are stale.
  const lastColumns = React.useRef(columns)
  if (lastColumns.current !== columns) {
    lastColumns.current = columns
    heightsRef.current.clear()
    baseRef.current = null
  }

  // --- layout signature: stale-height invalidation ------------------------
  // heightsRef entries outlive the commits that measured them, but many
  // state changes rewrite a row's height WITHOUT a columns change: Ctrl+O
  // (expanded), single-row expand (expandedRows), reasoning stream→fold,
  // a tool result/error/footnote arriving, diff layout switch, assistant
  // text growth, thinking visibility. A cached height from before such a
  // change feeds topPad/bottomPad spacers, the offsets scan, and the
  // ScrollBox clamps with geometry that no longer exists — blank bands,
  // overlapping rows, wrong scrollTop after toggles (the audit's stale
  // height cache). Track the inputs that decide each row's height; when
  // one changes, drop the cached height. The window extension further
  // down remounts invalidated rows so useLayoutEffect re-measures them.
  // Text identity uses length as an O(1) proxy — per-frame full-text
  // hashing over every row would defeat virtualization's budget, and a
  // same-length miss only degrades to the previous behavior.
  //
  // VECTORS, not strings: the cache stores the parts VECTOR and the
  // comparison is slot-by-slot — the unchanged case (every settled row on
  // every scroll tick) allocates nothing. A joined string per row per
  // render was O(rows) garbage per tick (3200-row session ⇒ several MB/s
  // into minor GC; the GC share of the scroll profile).
  const sigRef = React.useRef(new Map<number, Array<string | number | boolean>>())
  {
    const sigs = sigRef.current
    for (let i = 0; i < visibleRows.length; i++) {
      const row = visibleRows[i]!
      // Per-kind signature: only the inputs that row's OWN renderer consumes.
      // A global flat array (every field × every row) over-invalidates — a
      // /settings diffLayout switch used to drop every user/assistant/
      // reasoning height at once, remounting the widened window over rows
      // whose rendering never changed (Yoga spike + measure churn for
      // nothing). Base parts cover the universal height inputs.
      const parts = signatureParts(
        row,
        columns,
        expanded,
        expandedRows,
        streamViewToggledRows,
        thinkingVisible,
        thinkingFold,
        diffLayout,
        foldTerminalCommand,
        model,
        failureHintRowId,
        failureHint,
        revealDisplayLen(row, smoothStreaming),
        sessionCwd,
      )
      const cachedParts = sigs.get(row.id)
      let same = false
      if (cachedParts !== undefined && cachedParts.length === parts.length) {
        same = true
        for (let s = 0; s < parts.length; s++) {
          if (parts[s] !== cachedParts[s]) { same = false; break }
        }
      }
      if (same) continue
      if (sigs.size >= HEIGHTS_CACHE_MAX) {
        const oldest = sigs.keys().next().value
        if (oldest !== undefined) sigs.delete(oldest)
      }
      // Copy out of the module-level scratch buffer — the next row reuses it.
      sigs.set(row.id, parts.slice())
      heightsRef.current.delete(row.id)
    }
  }

  const heightOf = (row: ChatRow): number =>
    heightsRef.current.get(row.id) ?? DEFAULT_ROW_HEIGHT
  // Reused offsets buffer: the prefix-scan itself must run every render
  // (heightsRef mutates in the measure effect), but the ARRAY need not be
  // fresh — offsets never escapes this render scope. A new 3200-slot array
  // per scroll tick was pure GC fodder.
  const offsetsBufRef = React.useRef<number[]>([])
  const offsets: number[] = offsetsBufRef.current
  offsets.length = visibleRows.length
  let total = 0
  for (let i = 0; i < visibleRows.length; i++) {
    offsets[i] = total
    total += heightOf(visibleRows[i])
  }

  const viewport = termRows
  const base = baseRef.current ?? DEFAULT_HEADER_LINES
  let start = Math.max(0, visibleRows.length - 1)
  const end = visibleRows.length
  if (visibleRows.length > 0) {
    // Keep a terminal viewport of tail content mounted. Older rows stay
    // represented by their measured height after they reach scrollback.
    let covered = Math.min(viewport, termRows) + OVERSCAN_LINES
    let floor = visibleRows.length - 1
    while (floor > 0 && covered > 0) {
      covered -= heightOf(visibleRows[floor])
      floor--
    }
    // The walk exhausted the whole list: every row is within coverage —
    // floor+1 here would drop row 0 (its content then has no terminal copy
    // anywhere; preset history lost its head — CI repro-inline-scrollback).
    start = floor === 0 && covered > 0 ? 0 : floor + 1
    // Paint-at-least-once: extend the window over any row that has never
    // been mounted. A row the window skips keeps only its terminal/scrollback
    // copy — a row that was never painted has NO copy anywhere, so preset
    // history (session resume, repro-inline-scrollback's #39 family) would
    // vanish from the user's scrollback. Extending mounts everything above
    // on the first frame (topPad 0, full paint), then the set fills and the
    // window tightens to the tail.
    // FRAME-BUDGETED: mounting the whole window in ONE commit saturated the
    // main thread for seconds (measured 6s wall with ZERO frames in the
    // first second on an 800-row inline open — every input queued behind
    // the React render). Extend in batches of ~2 viewports of measured
    // height per commit instead; the pending-batch effect schedules the
    // next slice, so the app paints, drains input, and stays interactive
    // while history streams in above the fold (opencode-style progressive
    // transcript hydration; the terminal accepts rows whenever they land).
    const paintedOnce = paintedOnceRef.current
    let paintPending = false
    {
      // Persistent batch edge: the sticky floor-walk RESETS start to the
      // tail every frame, so a per-frame budget walk from `start` re-spends
      // its whole budget on already-painted rows and never reaches deeper
      // unpainted ones (measured: an infinite 0.3ms/frame batch loop).
      // Remember how far painting has advanced; each batch extends THAT
      // edge upward by the budget.
      if (paintEdgeRef.current < 0) paintEdgeRef.current = start
      let firstUnpainted = -1
      for (let i = 0; i < paintEdgeRef.current; i++) {
        if (!paintedOnce.has(visibleRows[i]!.id)) {
          firstUnpainted = i
          break
        }
      }
      if (firstUnpainted !== -1) {
        // Budget: extend the paint edge upward by ~half a viewport of
        // measured content per commit (height estimates; unknown rows fall
        // back to DEFAULT_ROW_HEIGHT and over-mount slightly — harmless).
        // Measured: larger batches (2 viewports) put 50ms+ of first-wrap
        // yoga into one frame; half a viewport keeps batches near the
        // 16ms frame budget while still finishing an 800-row open in
        // well under two seconds of background batches.
        let budget = Math.min(viewport, termRows) / 2 + OVERSCAN_LINES
        let j = paintEdgeRef.current
        while (j > firstUnpainted && budget > 0) {
          j--
          budget -= heightOf(visibleRows[j]!)
        }
        paintEdgeRef.current = j
        start = Math.min(start, j)
        paintPending = j > 0
      }
    }
    paintPendingRef.current = paintPending
    // Unknown-height extension (layout signature, see sigRef): a row whose
    // cached height was just INVALIDATED must remount to re-measure even
    // when it sits outside the window — its spacer otherwise falls back to
    // DEFAULT_ROW_HEIGHT until the row scrolls back into view, leaving the
    // content geometry wrong for exactly that long (blank band after
    // Ctrl+O, unreachable scroll bottom after a tool result lands). One
    // remount per change; the measure tick + hold then tighten again.
    // Guard 1: only rows that have actually MOUNTED here once qualify
    // (paintedOnce fills from localRefs post-commit) — a brand-new
    // streaming row has never been measured, and extending over it would
    // mount everything below the window every frame while the user reads
    // scrolled-up (virtualization defeated, per-frame full mount = the
    // long-session stall). New rows keep the original path: their height
    // lands once the window reaches them.
    // Guard 2: rows actively STREAMING are skipped too. A streaming row's
    // signature invalidates EVERY chunk (text length grows), so a painted
    // streaming row below/above the window remounted per chunk — full
    // markdown re-lex + wrap of the whole growing text, invisible to the
    // user reading history (measured: 3s of streaming while scrolled up
    // burned 2.5s of yoga and +84MB heap). Its height is in flux anyway;
    // the final settle invalidates once more and remounts exactly once.
    for (let i = 0; i < start; i++) {
      if (visibleRows[i]!.streaming === true) continue
      const rowId = visibleRows[i]!.id
      if (!heightsRef.current.has(rowId) && paintedOnceRef.current.has(rowId)) {
        start = i
        break
      }
    }
    // Expansion hold — AFTER the extension so it tracks the FINAL window:
    // never tighten past a widen until a frame with that layout has been
    // flushed (getTerminalFlushTick advanced since the widen). A mount
    // followed by the measure-tick re-render that drops the row paints only
    // the DROPPED layout, and the row's painted-once mark (set at the first
    // commit) is a lie; holding until the flush makes the mark real.
    if (
      lastStartRef.current >= 0 &&
      start > lastStartRef.current &&
      getTerminalFlushTick() === holdFlushTickRef.current
    ) {
      start = lastStartRef.current
    }
    if (lastStartRef.current < 0 || start < lastStartRef.current) {
      holdFlushTickRef.current = getTerminalFlushTick()
    }
    lastStartRef.current = start
  }
  const topPad = offsets[start] ?? 0
  noteListGeometry({
    start, end, topPad, bottomPad: 0, total, base, sticky: true,
    pending: 0, viewport, termRows, columns, rowCount: visibleRows.length,
  })

  // Measure mounted rows and continue painting older history in bounded batches.
  React.useLayoutEffect(() => {
    let changed = false
    // Mounted ⇒ painted: record rows eligible for window skipping.
    const paintedOnce = paintedOnceRef.current
    for (const id of localRefs.current.keys()) {
      if (!paintedOnce.has(id)) paintedOnce.add(id)
    }
    for (const [id, el] of localRefs.current) {
      const h = el.yogaNode?.getComputedHeight()
      if (h !== undefined && h > 0 && heightsRef.current.get(id) !== h) {
        if (heightsRef.current.size >= HEIGHTS_CACHE_MAX) {
          const oldest = heightsRef.current.keys().next().value
          if (oldest !== undefined) heightsRef.current.delete(oldest)
        }
        heightsRef.current.set(id, h)
        changed = true
      }
    }
    const firstMounted = visibleRows[start]
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard: empty list window
    const firstEl = firstMounted ? localRefs.current.get(firstMounted.id) : undefined
    const top = firstEl?.yogaNode?.getComputedTop()
    if (top !== undefined) {
      const measured = top - (offsets[start] ?? 0)
      if (baseRef.current !== measured) {
        baseRef.current = measured
        changed = true
      }
    }
    if (changed && measureTimerRef.current === null) {
      // Layout corrections can cascade for many rows. Yield to the next
      // macrotask so React does not count the valid convergence as nested
      // updates when a streaming/reveal commit is already in flight.
      measureTimerRef.current = setTimeout(() => {
        measureTimerRef.current = null
        noteFrameCause('measure')
        setMeasureTick(t => t + 1)
      }, 0)
    }
    // History-paint continuation (main-screen open): more never-painted
    // batches remain — schedule the next slice on the macrotask queue so
    // pending input events (wheel, keys) drain between batches and the app
    // stays interactive while preset history streams in. A timeout of 0 is
    // enough: each batch's mount+measure work is bounded (~2 viewports),
    // unlike the previous single-commit full mount that saturated the main
    // thread for seconds.
    if (paintPendingRef.current && paintTimerRef.current === null) {
      paintTimerRef.current = setTimeout(() => {
        paintTimerRef.current = null
        if (!paintPendingRef.current) return
        noteFrameCause('measure')
        setMeasureTick(t => t + 1)
      }, 0)
    }
  })

  // useCallback: the reference feeds MemoRow's shallow compare; a fresh
  // closure per render would defeat every row's memo.
  const setRowRef = React.useCallback((rowId: number, el: DOMElement | null): void => {
    if (el) localRefs.current.set(rowId, el)
    else localRefs.current.delete(rowId)
  }, [])

  return (
    <>
      {(olderHistory === true || rows.some(row => row.folded)) && (
        <ClickableDivider title={t('load-earlier')} onClick={onLoadOlder} />
      )}
      {!showAll && hiddenCount > 0 && (
        <ClickableDivider title={t('show-previous-messages', { n: hiddenCount })} onClick={onToggleAll} />
      )}
      {topPad > 0 && <Box height={topPad} flexShrink={0} />}
      {visibleRows
        .slice(start, end)
        .map((row) => {
        // The pre-pass result keeps windowed rows at full-mount
        // spacing; only the very first row of the whole list has none.
          const marginTopOnTurn = margins.get(row.id) === true
          const tool = row.tool
          const subagent = row.kind === 'subagent' ? row.subagent : undefined
          const job = row.kind === 'job' ? row.job : undefined
          const jobGroup = row.kind === 'job' ? row.jobGroup : undefined
          const revealVersion = smoothStreaming && row.kind === 'tool' && row.fresh === true &&
            row.tool?.status === 'running' && row.tool.resultView === undefined
            ? getRevealVersion()
            : 0
          // Smooth reveal feeds the SAME flattened text prop a chunk feeds,
          // and keeps the streaming layout alive until the reveal catches up
          // (settling mid-reveal must not snap — a one-shot non-streaming
          // delivery still paints as a flow).
          let displayText = row.text
          let displayStreaming = row.streaming === true
          if (row.kind === 'assistant' && smoothStreaming) {
            const stripped = stripNarration(row.text)
            displayText = revealTextOf(`a${row.id}`, stripped, {
              enabled: true,
              active: displayStreaming || row.fresh === true,
            })
            displayStreaming = displayStreaming || displayText.length !== stripped.length
          } else if (row.kind === 'assistant') {
            displayText = stripNarration(row.text)
          } else if (row.kind === 'reasoning' && smoothStreaming) {
            displayText = revealTextOf(`r${row.id}`, row.text, { enabled: true, active: displayStreaming })
          }
          return (
            <MemoRow
              key={row.id}
              rowId={row.id}
              kind={row.kind}
              text={displayText}
              images={row.images}
              textFull={row.kind === 'reasoning' ? row.text : undefined}
              executionTarget={row.executionTarget}
              selectionAttached={row.selectionAttached}
              streaming={displayStreaming}
              thinkingOpen={row.thinkingOpen === true}
              durationMs={row.durationMs}
              reasoningTokens={row.reasoningTokens}
              time={row.time}
              marginTopOnTurn={marginTopOnTurn}
              isSelected={selectedId === row.id}
              isExpanded={expandedRows.has(row.id)}
              expanded={expanded}
              model={model}
              diffLayout={diffLayout}
              thinkingFold={thinkingFold}
              toolBackground={toolBackground}
              foldTerminalCommand={foldTerminalCommand}
              smoothStreaming={smoothStreaming}
              fresh={row.fresh === true}
              revealVersion={revealVersion}
              background={rowBackground(row.id)}
              toolCallId={tool?.callId}
              toolName={tool?.name}
              toolArgsText={tool?.argsText}
              toolArgsFull={tool?.argsFull}
              toolStatus={tool?.status}
              toolResultText={tool?.resultText}
              toolResultFull={tool?.resultFull}
              toolErrorText={tool?.errorText}
              toolFootnote={failureHintRowId === row.id ? failureHint : undefined}
              toolCallView={tool?.callView}
              toolResultView={tool?.resultView}
              toolStartedAt={tool?.startedAt}
              toolDurationMs={tool?.durationMs}
              toolSourceFolded={row.folded === true}
              subagent={subagent}
              job={job}
              jobGroup={jobGroup}
              onToggleRow={onToggleRow}
              onToggleStreamView={onToggleStreamView}
              streamViewToggled={streamViewToggledRows.has(row.id)}
              onOpenSubagent={onOpenSubagent}
          onOpenSubagentView={onOpenSubagentView}
              onOpenJobs={onOpenJobs}
              onWatchJobOutput={onWatchJobOutput}
              onOpenFile={onOpenFile}
              sessionCwd={sessionCwd}
              setRowRef={setRowRef}
            />
          )
        })}
    </>
  )
}

// --- per-row memoization ---------------------------------------------------
// channel.ts mutates rows in place (`text += chunk`, `tool.status = ...`),
// so row-object identity can never detect an update. MemoRow flattens every
// rendered field into primitive props: React.memo's default shallow compare
// then sees each mutation as a changed string/number, while an untouched
// row compares equal in O(1) and skips render + reconciler diff entirely.
// Before this, every streamed chunk re-rendered every mounted row (~30-40
// in the virtualization window) and re-ran each row's markdown pipeline —
// the dominant long-session jank source.
type MemoRowProps = {
  rowId: number
  kind: ChatRow['kind']
  text: string
  images: readonly TranscriptImage[] | undefined
  /** Reasoning rows: the FULL un-revealed text — the live three-line preview
   *  ticker follows the newest arrived content (never the reveal), while the
   *  expanded body shows the revealed slice in `text`. */
  textFull?: string
  executionTarget: string | undefined
  /** IDE selection indicator (user rows): rendered above the prompt bubble. */
  selectionAttached: ChatRow['selectionAttached']
  /** Session cwd for the indicator's display-path relativization (T-FIX-01). */
  sessionCwd: string | undefined
  streaming: boolean
  thinkingOpen: boolean
  durationMs: number | undefined
  /** Estimated thinking tokens of a count-only reasoning row. */
  reasoningTokens: number | undefined
  time: number | undefined
  marginTopOnTurn: boolean
  isSelected: boolean
  isExpanded: boolean
  expanded: boolean
  model: string
  /** Edit/Write diff presentation preference (forwarded to tool cards). */
  diffLayout: 'auto' | 'split' | 'unified'
  /** Smooth streaming reveal (forwarded to thinking/tool renderers). */
  smoothStreaming: boolean
  /** Live-arrived row flag (drives tool-card reveal participation). */
  fresh: boolean
  /** Version tick for active tool reveal; 0 keeps settled rows memoized. */
  revealVersion: number
  thinkingFold: 'preview' | 'full'
  toolBackground: ToolBackground
  /** Terminal-card header folding (forwarded to tool cards). */
  foldTerminalCommand: boolean
  /** Working-activity preset name; drives the subagent card's running glyph. */
  background: 'messageActionsBackground' | undefined
  // ToolRow, flattened: the channel writes status/result fields in place,
  // so passing the object itself would make mutations invisible to memo.
  toolCallId: string | undefined
  toolName: string | undefined
  toolArgsText: string | undefined
  toolArgsFull: string | undefined
  toolStatus: ToolRow['status'] | undefined
  toolResultText: string | undefined
  toolResultFull: string | undefined
  toolErrorText: string | undefined
  /** Trajectory footnote, present on at most one row (the newest failure). */
  toolFootnote: string | undefined
  /** Presentation views are set-once stable refs (creation / settle), so a
   *  plain ref compare stays correct under the in-place mutation model. */
  toolCallView: ToolCallView | undefined
  toolResultView: ToolResultView | undefined
  toolStartedAt: number | undefined
  toolDurationMs: number | undefined
  /** Row-level source fold (window cap dropped full payloads): the expanded
   *  card discloses preview-only instead of passing it off as full text. */
  toolSourceFolded: boolean
  // SubagentRow, stable ref (subagent lifecycle events update the store, not
  // the row ref itself, so a plain ref compare stays correct).
  subagent: SubagentRow | undefined
  // JobRow, same update contract as SubagentRow (replaced per job commit).
  job: JobRow | undefined
  /** Group decoration for a run of consecutive job cards (see JobGroupRow). */
  jobGroup: JobGroupRow | undefined
  onToggleRow: (rowId: number) => void
  /** 流式 reasoning 行在三行预览/全文间切换；落定行用 onToggleRow。 */
  onToggleStreamView: (rowId: number) => void
  /** 是否反转该流式行的 thinkingFold 默认视图。 */
  streamViewToggled: boolean
  onOpenSubagent: ((agentId: string) => void) | undefined
  onOpenSubagentView: ((agentId: string, rowId: number) => void) | undefined
  onOpenJobs: ((focusId?: string) => void) | undefined
  onWatchJobOutput: ((id: string) => () => void) | undefined
  onOpenFile: ((path: string) => void) | undefined
  setRowRef: (rowId: number, el: DOMElement | null) => void
}

/** Load-earlier / show-previous divider row with a mouse hover tint — the
 *  clickability is otherwise invisible (audit C-04). */
function ClickableDivider({ title, onClick }: { title: string; onClick?: () => void }): React.ReactNode {
  const [hovered, setHovered] = useState(false)
  return (
    <Box
      marginTop={1}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      backgroundColor={hovered ? 'userMessageBackgroundHover' : undefined}
    >
      <Divider title={title} />
    </Box>
  )
}

function TranscriptRow({
  rowId,
  kind,
  text,
  images,
  textFull,
  executionTarget,
  selectionAttached,
  sessionCwd,
  streaming,
  thinkingOpen,
  durationMs,
  reasoningTokens,
  time,
  marginTopOnTurn,
  isSelected,
  isExpanded,
  expanded,
  model,
  diffLayout,
  smoothStreaming,
  fresh,
  revealVersion,
  thinkingFold,
  toolBackground,
  foldTerminalCommand,
  background,
  toolCallId,
  toolName,
  toolArgsText,
  toolArgsFull,
  toolStatus,
  toolResultText,
  toolResultFull,
  toolErrorText,
  toolFootnote,
  toolCallView,
  toolResultView,
  toolStartedAt,
  toolDurationMs,
  toolSourceFolded,
  subagent,
  job,
  jobGroup,
  onToggleRow,
  onToggleStreamView,
  streamViewToggled,
  onOpenSubagent,
  onOpenSubagentView,
  onOpenJobs,
  onWatchJobOutput,
  onOpenFile,
  setRowRef,
}: MemoRowProps): React.ReactNode {
  const ref = React.useCallback(
    (el: DOMElement | null): void => {
      setRowRef(rowId, el)
    },
    [setRowRef, rowId],
  )
  // 可折叠行（工具卡/思考/compact 摘要）共用：点击切换展开，全宽行右侧
  // 空白（屏幕缓冲未写入单元格）不触发——点击空白想选字/拖拽时不再误触
  // 展开/收起（审计 C-03/cellIsBlank 零消费）。纯文本行（user/assistant）
  // 平时不可点：转录是阅读区（用户反馈），折叠语义留给带视觉指示的行——
  // 唯一例外是**被折叠的超长单行**：那时整行就是展开开关（见 foldClickable）。
  const foldOnClick = React.useCallback((event: ClickEvent): void => {
    if (event.cellIsBlank) return
    onToggleRow(rowId)
  }, [onToggleRow, rowId])
  // 当前回合仍展开的 reasoning 行：点击在三行预览/全文间切换。它反转
  // thinkingFold 的默认值，回合落定后语义自动回到 foldOnClick。
  const streamViewOnClick = React.useCallback((event: ClickEvent): void => {
    if (event.cellIsBlank) return
    onToggleStreamView(rowId)
  }, [onToggleStreamView, rowId])
  // 任务组：点击组头行折叠/展开整组（与工具卡的折叠同一套手势：行点击 =
  // expandedRows 切换，Ctrl+O 展开全部）。
  const toggleJobGroup = React.useCallback((): void => {
    onToggleRow(rowId)
  }, [onToggleRow, rowId])
  // 子代理卡：点击打开详情场景（不是折叠）。
  const openSubagent = React.useCallback(() => {
    if (subagent !== undefined) onOpenSubagent?.(subagent.agentId)
  }, [onOpenSubagent, subagent])
  // compact 摘要折叠行 hover 轻指示（∴ 提亮，不刷背景）。
  const [compactHovered, setCompactHovered] = useState(false)

  // Long single lines are clipped before layout (utils/fold-long-lines.ts):
  // one 300k-char paste or minified-JS line otherwise wraps into thousands of
  // visual rows and that per-frame wrap — not the row count — dominates the
  // frame. Ctrl+O (global) AND a row click (per-row, the same `expandedRows`
  // gesture message-selection mode uses) both paint the raw text again.
  // Reasoning rows are deliberately excluded: their preview is already a fixed
  // three-row ticker. Tool cards fold inside their own header/body
  // (AssistantToolUseMessage), whose text never rides this prop.
  const foldable = kind !== 'reasoning' && kind !== 'tool'
  const folded = React.useMemo(
    () => (foldable ? foldLongLines(text) : { text, hiddenChars: 0, foldedLines: 0 }),
    [foldable, text],
  )
  const displayText = expanded || isExpanded ? text : folded.text
  // Mouse toggle: only a row that ACTUALLY hides something is clickable (an
  // ordinary message stays inert so plain clicks and drag-selection keep
  // working there). A streaming row is clickable too — the same contract the
  // tool card has while running: the click paints the full ARRIVED text, and
  // the reveal keeps growing it.
  const foldClickable = foldable && folded.hiddenChars > 0

  switch (kind) {
    case 'user':
      return (
        <Box flexDirection="column" ref={ref} onClick={foldClickable ? foldOnClick : undefined}>
          {selectionAttached && (
            <Text dimColor>
              {'⧉ '}{t('selection-attached', {
                lines: selectionAttached.lines,
                count: selectionAttached.lines,
                path: displaySelectionPath(selectionAttached.path, sessionCwd),
              })}
            </Text>
          )}
          {text !== '' && (
            <UserPromptMessage
              text={displayText}
              marginTopOnTurn={marginTopOnTurn}
              isSelected={isSelected}
            />
          )}
          {images !== undefined && (
            <Box marginTop={text === '' && marginTopOnTurn ? 1 : 0}>
              <TranscriptImages images={images} />
            </Box>
          )}
        </Box>
      )
    case 'assistant':
      return streaming ? (
        <Box
          alignItems="flex-start"
          flexDirection="row"
          marginTop={marginTopOnTurn ? 1 : 0}
          width="100%"
          backgroundColor={background}
          ref={ref}
          onClick={foldClickable ? foldOnClick : undefined}
        >
          <Box minWidth={2}>
            <Text color="text">●</Text>
          </Box>
          <Box flexDirection="column">
            {/* The ⏵ self-narration line (working-activity narrate contract)
              is stripped here: the live working line on the status bar
              already shows it. */}
            <StreamingMarkdown>{stripNarration(displayText)}</StreamingMarkdown>
            {images !== undefined && <TranscriptImages images={images} indent={0} />}
          </Box>
        </Box>
      ) : (
        <Box
          width="100%"
          flexDirection="column"
          backgroundColor={background}
          ref={ref}
          onClick={foldClickable ? foldOnClick : undefined}
        >
          {expanded && (
            <Box
              flexDirection="row"
              justifyContent="flex-end"
              gap={1}
              marginTop={1}
            >
              <MessageMetadata timestamp={time} model={model} />
            </Box>
          )}
          <AssistantTextLeafRow
            text={stripNarration(displayText)}
            marginTopOnTurn={marginTopOnTurn}
            isSelected={isSelected}
            isExpanded={isExpanded}
          />
          {images !== undefined && <TranscriptImages images={images} />}
        </Box>
      )
    case 'reasoning': {
      // The setting chooses the live default; a row click reverses it. Global
      // or per-row transcript expansion always wins and shows the full text.
      const turnOpen = streaming || thinkingOpen
      const streamPreview = turnOpen && !expanded && !isExpanded &&
        (streamViewToggled ? thinkingFold === 'full' : thinkingFold === 'preview')
      return (
        <Box flexDirection="column" ref={ref}>
          <ThinkingLeafRow
            thinking={text}
            textFull={textFull}
            marginTopOnTurn={marginTopOnTurn}
            streaming={streaming}
            preview={streamPreview}
            // Settled rows keep the fold-on-settle default and expand via
            // expandedRows/Ctrl+O; a current-turn row is preview or full.
            verbose={isExpanded || expanded || (turnOpen && !streamPreview)}
            durationMs={durationMs}
            reasoningTokens={reasoningTokens}
            isSelected={isSelected}
            onClick={turnOpen ? streamViewOnClick : foldOnClick}
          />
        </Box>
      )
    }
    case 'tool': {
      if (
        toolCallId === undefined ||
        toolName === undefined ||
        toolArgsText === undefined ||
        toolStatus === undefined ||
        toolStartedAt === undefined
      ) {
        return null
      }
      // Rebuilt per render from the flattened props — cheap object literal,
      // and AssistantToolUseMessage is only reached when memo let us through.
      const tool: ToolRow = {
        callId: toolCallId,
        name: toolName,
        argsText: toolArgsText,
        argsFull: toolArgsFull,
        status: toolStatus,
        resultText: toolResultText,
        resultFull: toolResultFull,
        errorText: toolErrorText,
        callView: toolCallView,
        resultView: toolResultView,
        startedAt: toolStartedAt,
        durationMs: toolDurationMs,
      }
      return (
        <Box flexDirection="column" ref={ref}>
          <ToolLeafRow
            tool={tool}
            marginTopOnTurn={marginTopOnTurn}
            verbose={isExpanded || expanded}
            isSelected={isSelected}
            isExpanded={isExpanded}
            footnote={toolFootnote}
            diffLayout={diffLayout}
            toolBackground={toolBackground}
            smoothReveal={smoothStreaming}
            fresh={fresh}
            revealVersion={revealVersion}
            foldTerminalCommand={foldTerminalCommand}
            onClick={foldOnClick}
            onOpenFile={onOpenFile}
            images={images}
            sourceFolded={toolSourceFolded}
          />
        </Box>
      )
    }
    case 'notice':
      return (
        <Box marginTop={1} ref={ref} onClick={foldClickable ? foldOnClick : undefined}>
          <Divider title={` ${displayText} `} />
        </Box>
      )
    case 'interrupt':
      return (
        <Box marginTop={1} ref={ref}>
          <TurnInterruptedRow />
        </Box>
      )
    case 'turn-summary':
      return null
    case 'local':
      // `!` mode command echo.
      return (
        <Box marginTop={1} backgroundColor={background} ref={ref} onClick={foldClickable ? foldOnClick : undefined}>
          <Text color="bashBorder">!{executionTarget ? ` [${executionTarget}]` : ''} {displayText}</Text>
        </Box>
      )
    case 'local-output':
      return (
        <Box paddingLeft={2} backgroundColor={background} ref={ref} onClick={foldClickable ? foldOnClick : undefined}>
          <Text dimColor>{displayText}</Text>
        </Box>
      )
    case 'compact':
      // The post-compaction summary defaults to a folded one-liner with a
      // text preview; Ctrl+O (global), message-selection Enter, or a click
      // reveals the full summary.
      return (
        <Box
          marginTop={marginTopOnTurn ? 1 : 0}
          paddingLeft={2}
          backgroundColor={background}
          ref={ref}
          onClick={foldOnClick}
          onMouseEnter={() => setCompactHovered(true)}
          onMouseLeave={() => setCompactHovered(false)}
        >
          {expanded || isExpanded ? (
            <Text dimColor>{text}</Text>
          ) : (
            <Text dimColor italic color={compactHovered ? 'text' : undefined}>
              <Text color={compactHovered ? 'text' : undefined}>∴</Text>
              {' '}{t('compact-summary-folded')} · {compactPreview(displayText)}{' '}
              {t('hint-expand-ctrl-o', { key: primaryComboString('transcript') })}
            </Text>
          )}
        </Box>
      )
    case 'subagent':
      if (!subagent) return null
      return (
        <Box flexDirection="column" ref={ref}>
          <SubagentMessage
            subagent={subagent}
            marginTopOnTurn={marginTopOnTurn}
            isExpanded={isExpanded}
            onClick={openSubagent}
            onOpenView={onOpenSubagentView === undefined ? undefined : () => onOpenSubagentView(subagent.agentId, rowId)}
          />
        </Box>
      )
    case 'job': {
      if (!job) return null
      // A grouped run renders as ONE block: the head row carries the summary
      // line, members hang off the shared rail, and a FOLDED run keeps only
      // that summary (its members were dropped from the window upstream).
      const groupHead = jobGroup !== undefined && jobGroup.head
      return (
        <Box
          flexDirection="column"
          // The head's block margin moves UP to the group (the summary line
          // is what separates the run from what precedes it); the card under
          // it must not add a second blank line.
          marginTop={groupHead && marginTopOnTurn ? 1 : 0}
          ref={ref}
        >
          {groupHead && <JobGroupHeader group={jobGroup} onToggle={toggleJobGroup} />}
          {groupHead && jobGroup.folded ? null : (
            <JobCard
              job={job}
              expanded={isExpanded !== expanded}
              onToggle={toggleJobGroup}
              marginTopOnTurn={groupHead ? false : marginTopOnTurn}
              // Clicking a card opens the panel focused on THAT job, not the roster head.
              onClick={onOpenJobs === undefined ? undefined : () => onOpenJobs(job.id)}
              onWatchOutput={onWatchJobOutput}
            />
          )}
        </Box>
      )
    }
  }
}

/** Folded compact-summary preview: whitespace flattened, capped with an
 *  ellipsis so the fold line never wraps. `limit` is terminal cells, so
 *  CJK wide chars count double and never split mid-glyph. */
function compactPreview(text: string, limit = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return stringWidth(flat) <= limit ? flat : `${truncateToWidth(flat, limit - 1)}…`
}

const MemoRow = React.memo(TranscriptRow)
