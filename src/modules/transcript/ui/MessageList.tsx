

import { revealDisplayLen } from './list-signatures.js'
import { displaySelectionPath } from './list-signatures.js'

import { jobStatusCode } from './list-signatures.js'
import { signatureParts } from './list-signatures.js'

import { ClickableDivider } from './TranscriptRow.js'


import { MemoRow } from './TranscriptRow.js'


import React, { useState } from 'react'


import type { ChatRow } from '../../../shared/protocol/transcript.js'
import { t } from '../../../shared/i18n.js'
import type { ToolBackground } from '../../../shared/platform/display-preferences.js'
import { isQuietTool } from '../../../shared/platform/tool-name.js'
import { groupToolRuns } from '../model/tool-groups.js'

import type { DOMElement } from '../../../ink/dom.js'

import { getTerminalFlushTick } from '../../../ink/flush-tick.js'
import { noteFrameCause, noteListGeometry } from '../../../ink/geometry-trace.js'


import { stripNarration } from '../../../shared/platform/narration.js'

import { useRevealVersion } from '../../../ui/hooks/useRevealVersion.js'
import { Box, useTerminalSize } from '../../../ui/primitives.js'


import { getRevealVersion, revealTextOf } from '../../../ui/streaming-reveal.js'

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

/** A run of this many settled job cards folds into its own summary line.
 *  Two jobs are still a pair worth reading card by card — the group rail
 *  alone already saves their separator lines. Ctrl+O and a click on the
 *  summary reopen any group; clicking again folds it back. */
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
const NO_EXPANDED_DETAILS: ReadonlySet<number> = new Set()
const NOOP_TOGGLE_DETAIL = (_rowId: number): void => {}

// --- smooth-streaming display text -----------------------------------------
// Render-phase reads of the shared reveal cursors (see smoothReveal.ts for
// why the cursors live outside React). `active` gates cursor CREATION to
// live-arrived content (streaming rows, live-settled rows marked `fresh`,
// replayed history paints complete); once created, a cursor keeps revealing
// until it catches up — settling mid-reveal must not snap (that is the
// "non-streaming delivery becomes a smooth flow" contract).


/** Display length only (layout signature; no slice allocation). */


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


/** Status code for the job-group fingerprint (a hash input only — the values
 *  just have to be distinct per status). */


export function MessageList({
  rows,
  expanded,
  expandedRows,
  expandedDetails = NO_EXPANDED_DETAILS,
  selectedId,
  onToggleRow,
  onToggleDetail = NOOP_TOGGLE_DETAIL,
  streamViewToggledRows = NO_STREAM_VIEW_TOGGLED,
  onToggleStreamView = NOOP_TOGGLE_STREAM_VIEW,
  model,
  diffLayout = 'auto',
  thinkingFold = 'preview',
  toolBackground = 'none',
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
  /** Per-card body expansion (click). Group folds live in {@link expandedRows};
   *  separate sets keep a card click from folding its group. */
  expandedDetails?: ReadonlySet<number>
  selectedId: number | null
  onToggleRow: (rowId: number) => void
  onToggleDetail?: (rowId: number) => void
  /** 流式 reasoning 行相对 thinkingFold 默认视图的逐行切换。 */
  streamViewToggledRows?: ReadonlySet<number>
  onToggleStreamView?: (rowId: number) => void
  model: string
  /** Edit/Write diff presentation preference (forwarded to tool cards). */
  diffLayout?: 'auto' | 'split' | 'unified'
  /** Thinking-block display mode from channel (`preview`/`full`). */
  thinkingFold?: 'preview' | 'full'
  /** Tool-card background treatment from the live channel settings. */
  toolBackground?: ToolBackground
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
    /** Fold fingerprint (see below): job/tool rows settle IN PLACE, and a
     *  settling run changes how — and whether — its members render. */
    foldSig: number
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
  // Fold fingerprint: job and quiet-tool statuses land IN PLACE (`row.job`
  // is re-assigned by the projection, `row.tool.status` is mutated, the row
  // array never moves) and the expand toggles live in a Set — none of that
  // shows up in the rows identity or length key above, yet both decide
  // whether a consecutive run folds, and a folded run REMOVES its members
  // from the visible window. One allocation-free pass over the row list.
  let foldSig = (expanded ? 1 : 0) * 7
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (row.kind === 'job' && row.job !== undefined) {
      foldSig = (foldSig * 33 + row.id + jobStatusCode(row.job.status) + (expandedRows.has(row.id) ? 7 : 0)) | 0
    } else if (row.kind === 'tool' && row.tool !== undefined &&
      isQuietTool(row.tool, row.tool.resultView ?? row.tool.callView)) {
      const status = row.tool.status === 'running' ? 1 : row.tool.status === 'error' ? 2 : 3
      foldSig = (foldSig * 33 + row.id + status + (expandedRows.has(row.id) ? 7 : 0)) | 0
    }
  }
  if (
    visibleCache === null ||
    visibleCache.rows !== rows ||
    visibleCache.rowsLength !== rows.length ||
    visibleCache.showAll !== (showAll || hiddenCount <= 0) ||
    visibleCache.thinkingVisible !== thinkingVisible ||
    visibleCache.foldSig !== foldSig ||
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
      // A settled run folds into its summary; Ctrl+O force-expands every
      // run, and a header click lands in expandedRows.
      const folded = count >= JOB_GROUP_FOLD_MIN && running === 0 &&
        !expanded && !expandedRows.has(head.id)
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
    // Settled shell/job runs fold after their own pass: only the summary
    // row remains, so the group disappears from the visible window with the
    // same pre-virtualization contract as the job groups.
    const toolGroups = groupToolRuns(out, expanded, expandedRows)
    out = toolGroups.rows
    for (const id of toolGroups.folded) foldedMembers.add(id)
    const visibleOut = foldedMembers.size === 0 ? out : out.filter(row => !foldedMembers.has(row.id))
    // Every rendered block gets a 1-row top margin except the first. Pre-pass
    // over the FULL list so a windowed row keeps the exact spacing it would
    // have in a fully-mounted list. Group members sit flush under their head,
    // and consecutive tool cards share the same dense rhythm (their headers
    // are already the separator).
    const margins = new Map<number, boolean>()
    {
      let prev: ChatRow['kind'] | undefined
      for (const row of visibleOut) {
        const member = (row.jobGroup !== undefined && !row.jobGroup.head) ||
          (row.toolGroup !== undefined && !row.toolGroup.head)
        const dense = row.kind === 'tool' && prev === 'tool'
        margins.set(row.id, prev !== undefined && !member && !dense)
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
      foldSig,
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
        expandedDetails,
        streamViewToggledRows,
        thinkingVisible,
        thinkingFold,
        diffLayout,
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
          const toolGroup = row.kind === 'tool' ? row.toolGroup : undefined
          // Group folding and card-body expansion are separate gestures: a
          // grouped card click must not fold its group. Ungrouped rows keep
          // the old expandedRows behavior (message-selection Enter included).
          const grouped = row.jobGroup !== undefined || row.toolGroup !== undefined
          const isDetailExpanded = expandedDetails.has(row.id) || (!grouped && expandedRows.has(row.id))
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
              commandResult={row.commandResult}
              emphasis={row.emphasis === true}
              selectionAttached={row.selectionAttached}
              streaming={displayStreaming}
              thinkingOpen={row.thinkingOpen === true}
              durationMs={row.durationMs}
              reasoningTokens={row.reasoningTokens}
              time={row.time}
              marginTopOnTurn={marginTopOnTurn}
              isSelected={selectedId === row.id}
              isExpanded={expandedRows.has(row.id)}
              isDetailExpanded={isDetailExpanded}
              expanded={expanded}
              model={model}
              diffLayout={diffLayout}
              thinkingFold={thinkingFold}
              toolBackground={toolBackground}
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
              toolGroup={toolGroup}
              onToggleRow={onToggleRow}
              onToggleDetail={onToggleDetail}
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


/** Load-earlier / show-previous divider row with a mouse hover tint — the
 *  clickability is otherwise invisible (audit C-04). */


/** Folded compact-summary preview: whitespace flattened, capped with an
 *  ellipsis so the fold line never wraps. `limit` is terminal cells, so
 *  CJK wide chars count double and never split mid-glyph. */


export { displaySelectionPath } from './list-signatures.js'
