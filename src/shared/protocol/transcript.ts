import type { SelectionAttachment, TranscriptImage } from './composer.js'
import type { JobGroupRow, JobRow } from './jobs.js'
import type { SubagentRow } from './subagents.js'

/**
 * Group decoration for a run of consecutive shell/job tool calls.
 *
 * Settled runs of ≥3 of the same tool render as one summary line instead of
 * N header rows. Clicking the summary (or Ctrl+O) expands the run; a failure
 * count stays visible in the error color while folded. Derived state: it
 * rides shallow copies in the transcript pre-pass, never the shared rows.
 */
export interface ToolGroupRow {
  /** Group header row: the only member rendering the summary line. */
  head: boolean
  /** Last member of the run. */
  last: boolean
  /** Members in the run (≥3 — shorter pairs stay card by card). */
  count: number
  /** Whole group folded into the summary line (meaningful on the head). */
  folded: boolean
  /** Failed members; painted in the error color while folded. */
  failed: number
  /** Tool name as the card resolves it (`bash`, `job_output`, …). */
  name: string
  /** Earliest member start. */
  startedAt: number
  /** Latest member finish. */
  endedAt: number
}

/**
 * One rendered transcript row. The DSH session log is the source of truth:
 * rows are derived from `session/event` records (and the initial
 * `agent.session.events` replay), never from optimistic local state.
 */
export interface ChatRow {
  id: number
  kind: 'user' | 'assistant' | 'tool' | 'notice' | 'reasoning' | 'interrupt' | 'local' | 'local-output' | 'compact' | 'subagent' | 'job' | 'turn-summary'
  /** Extra label for non-human user rows (e.g. `steering`). */
  label?: string
  /** Actual execution location for `!command` rows. */
  executionTarget?: string
  /** Ephemeral grouping for a command result shown in the transcript. */
  commandResult?: 'start' | 'middle' | 'end' | 'only'
  /** Render a `local-output` line at normal brightness (answered questionnaire
   *  answers); question lines and ordinary command output stay dim. */
  emphasis?: boolean
  text: string
  /** Durable session image blocks, loaded lazily through the attachment store. */
  images?: readonly TranscriptImage[]
  /** True while an assistant step is still streaming chunks. */
  streaming?: boolean
  /** Keep a settled reasoning row expanded until the current turn ends. */
  thinkingOpen?: boolean
  /** Present on `tool` rows; the card model. */
  tool?: ToolRow
  /** Present on `turn-summary` rows; the turn's usage ledger. */
  turnUsage?: TurnUsageSummary
  /** Present on `subagent` rows; the subagent state snapshot. */
  subagent?: SubagentRow
  /** Present on `job` rows; the background-job state snapshot. */
  job?: JobRow
  /** Present on `job` rows that share a run of ≥2 consecutive cards: the
   *  group decoration (chain rail + fold summary). Render-derived state:
   *  written only onto shallow copies in the transcript's row pre-pass
   *  (rows may arrive frozen from the session projection), never by the
   *  projection and never on the shared row objects. */
  jobGroup?: JobGroupRow
  /** Present on `tool` rows that share a settled run of ≥3 calls of the same
   *  shell/job tool: the compact summary decoration. Same derived-state
   *  contract as {@link jobGroup}. */
  toolGroup?: ToolGroupRow
  /** Event wall-clock time (transcript-mode metadata, assistant rows). */
  time?: number
  /** Present on `reasoning` rows once settled: thinking wall-clock duration. */
  durationMs?: number
  /** Present on `reasoning` rows of a backend that reports thinking only as
   *  an estimated token count (no thinking text): the latest estimate. The
   *  text, when any arrives, still wins over the count. */
  reasoningTokens?: number
  /** Source session event seq — present on every log-derived row (rewind
   *  fork anchor on user rows; window-floor bookkeeping for the rest). */
  seq?: number
  /** The backend's own durable anchor of a row when it is not the row's
   *  `seq`: a `user` row's rewind anchor (a Claude message uuid), an
   *  `assistant`/`reasoning` row's message (a Claude API message id, which
   *  "load earlier" uses to find the record a folded row came from); absent
   *  on DSH rows, whose anchor is the seq itself. */
  anchor?: string
  /** True when the row's full text was folded to keep the transcript window
   *  bounded (see MAX_ROWS); the session log still holds the full content
   *  and loadOlder() restores it. */
  folded?: boolean
  /** True when loadOlder() restored this row from the log; restored rows are
   *  exempt from the next fold pass so a restore is not instantly undone. */
  restored?: boolean
  /** True on rows created by LIVE event handling (not replay/resume/fold
   *  restore) — the smooth-streaming reveal animates freshly-arrived
   *  content only; replayed history must paint complete. Set once at
   *  creation; never mutated afterwards. */
  fresh?: boolean
  /** Present on user rows whose submit consumed a live IDE selection: the
   *  transcript renders the "Selected N lines" indicator above the bubble. */
  selectionAttached?: SelectionAttachment
}

/** Tool-call card state: the presentation of one tool invocation. */
export interface ToolRow {
  readonly callId: string
  readonly name: string
  /** Raw JSON arguments as the model produced them (displayed truncated). */
  readonly argsText: string
  /** Full arguments, shown when Ctrl+O verbose mode is on; dropped when the
   *  row is folded (session log retains it). */
  argsFull?: string
  status: 'running' | 'ok' | 'error'
  resultText?: string
  /** Full result text, shown when Ctrl+O verbose mode is on. */
  resultFull?: string
  errorText?: string
  /** Tool-owned render intent from dsh-tools `presentCall` (diff/terminal/
   *  generic). Drives the structured card body instead of the raw text. */
  callView?: ToolCallView
  /** Tool-owned completed-state view from `presentResult` (applied diff
   *  hunks, terminal output, read content…). Wins over callView once set. */
  resultView?: ToolResultView
  /** Wall-clock start of the call (live elapsed while running). */
  startedAt: number
  /** Settled wall-clock duration, written by tool/result. */
  durationMs?: number
}

/** Pending-call render intent (structural subset of dsh-tools ToolCallView). */
export type ToolCallView = ToolViewMeta & (
  | { readonly card: 'generic'; readonly title: string; readonly kind?: string }
  | { readonly card: 'terminal'; readonly title: string; readonly description?: string; readonly cwd?: string }
  | { readonly card: 'diff'; readonly title: string; readonly diffs: readonly ToolFileDiff[] }
)

/**
 * Optional backend decoration of a tool view: the i18n key of the tool's
 * display name (`tool-name-*`; absent = the card localizes the raw tool id)
 * and its colour family (absent = derived from the tool id).
 */
export interface ToolViewMeta {
  readonly displayKey?: string
  readonly category?: 'mutate' | 'exec' | 'other'
}

/** One file change in a tool presentation (dsh-tools FileDiff). */
export interface ToolFileDiff {
  readonly path: string
  /** Prior content, or null for a new file / no before-image. */
  readonly oldText: string | null
  readonly newText: string
}

/** Completed-call render intent (structural subset of dsh-tools
 *  ToolResultView). `web` results and unknown shapes fall back to raw text. */
export type ToolResultView = ToolViewMeta & (
  | { readonly card: 'generic'; readonly title?: string; readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }> }
  | { readonly card: 'terminal'; readonly title?: string; readonly output?: string; readonly exitCode?: number; readonly signal?: string }
  | { readonly card: 'diff'; readonly title?: string; readonly diffs: readonly ToolFileDiff[] }
  | { readonly card: 'read'; readonly title?: string; readonly path?: string; readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }> }
  | {
      readonly card: 'search'
      readonly shape: 'matches'
      readonly title?: string
      readonly files: ReadonlyArray<{ readonly path: string; readonly matches: ReadonlyArray<{ readonly lineNumber: number; readonly line: string }> }>
      readonly truncated: boolean
      readonly total: number
    }
  | { readonly card: 'search'; readonly shape: 'paths'; readonly title?: string; readonly paths: readonly string[]; readonly truncated: boolean; readonly total: number }
)

/** Running token totals across the session's assistant messages. */
export interface TokenUsage {
  input: number
  output: number
  /** Prompt-cache hit tokens across the session (priced at the hit rate). */
  cacheRead: number
  /** Prompt-cache write tokens across the session (priced with uncached input). */
  cacheWrite: number
  /** Peak-hour tokens (billed at peak rates) — each usage lands in a bucket
   *  by its event time, so a session spanning both windows is priced per
   *  window instead of all at the current rate. */
  peak: TokenBucket
  /** Off-peak-hour tokens (billed at idle rates). */
  idle: TokenBucket
}

/** One 计费时段（高峰/空闲）的 token 累计。 */
export interface TokenBucket {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** 一个模型的峰谷计价桶（与 {@link TokenUsage} 的 peak/idle 同构）。 */
export interface CostTokenBuckets {
  peak: TokenBucket
  idle: TokenBucket
}

/** One completed turn's usage ledger: the sum of that turn's
 * assistant-message usages. Each message reports its own request, so the sum
 * is the turn total and stays separate from the cumulative `tokens` (a
 * turn-level report from the backend must not be added on top). Absent wire
 * fields stay absent: `cacheKnown` tells "the route reported zero cache"
 * from "the route reports no cache at all", so the UI never shows a made-up
 * zero. */
export interface TurnUsageSummary {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  /** True when any cache field was present on the wire this turn. */
  readonly cacheKnown: boolean
  /** Attempts within the turn that failed and were superseded (API
   * retries); 0 means no retry segment renders. */
  readonly retries: number
  /** turn.start → turn.end wall-clock span (ms). */
  readonly durationMs: number
  /** Model id the turn's last request ran on, when the backend reported
   * one; absent rather than guessed from the session model. */
  readonly model?: string
  /** True when `model` differs from the previous turn's (or is the first
   * turn with a model). The row names the model only then, since repeating
   * an unchanged model every turn is noise; the commands still see it. */
  readonly noteModel?: boolean
  /** Reasoning effort the turn's requests pinned, when known. */
  readonly effort?: string
  /** How the turn ended; an interrupted turn's ledger is partial and the
   * row says so. */
  readonly outcome: 'completed' | 'interrupted' | 'error'
}

/**
 * 本会话主会话用量按模型分桶（费用估算输入，见 estimateCostFromBucketsCny）。
 * `channel.tokens` 的语义与既有显示不变；本字段只服务计价，会话中途换模型时
 * 历史用量留在原模型桶，不会被新模型重估。
 */
export interface SessionCostByModel {
  [model: string]: CostTokenBuckets
}

/**
 * 子代理 durable 用量按 (provider, model) 分桶——子代理各自模型不同，价格
 * 也就不同；未计价判定由计价纯函数按 provider/model 完成。
 */
export interface SubagentCostEntry {
  provider: string
  model: string
  buckets: CostTokenBuckets
}
