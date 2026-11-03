

/** Output-stream label of one mirrored job line; absent = plain stdout. */
export type BackgroundJobOutputChannel = 'stdout' | 'stderr' | 'log'

/** One mirrored output line. `channel` rides the kernel chunk label
 * (`stderr` renders red, `log` = producer narration the model never sees);
 * `gapBefore` marks bytes lost before this line (ring eviction / producer
 * gap) — the UI renders a dim `…dropped…` banner above it. */
export interface BackgroundJobOutputLine {
  text: string
  channel?: BackgroundJobOutputChannel
  gapBefore?: true
}

/** One background job as a live transcript card (see `kind: 'job'`). */
export interface JobRow {
  id: string
  kind: string
  label: string
  status: BackgroundJobStatus
  detail?: string
  /** Live producer progress line (`3/10`, phase name); cleared at settle. */
  progress?: string
  startedAt: number
  finishedAt?: number
  /** Mirrored output tail feeding the card's three-line waterfall. */
  outputLines: readonly BackgroundJobOutputLine[]
}

/**
 * Background-job projection for the UI (`/jobs` panel, transcript cards,
 * status-line chip, completion toasts).
 *
 * The domain model sits on top of the harness job registry (`ctx.jobs`,
 * `@deepseek-ai/dsh-jobs`). The registry is an optional service the TUI
 * never hard-depends on: channel.ts reaches it through a local structural
 * type ({@link JobsRuntime}), so compositions without the jobs plugin load
 * the UI unchanged with the feature silently off.
 *
 * Two registry rules shape everything here:
 *
 * - `read()` is CONSUMING (one cursor per job) and a terminal read marks the
 *   job reported, which would eat the owning agent's `job_output` delta and
 *   suppress its completion notice. The UI therefore never calls `read()`.
 *   Output mirroring has two tiers: when the kernel event bus is reachable
 *   (`events.subscribe`, present on the real registry) the UI keeps its own
 *   byte cursor and pulls non-consuming `readAt` increments on every
 *   `output` event — live output without the model polling; on kernels
 *   without the bus it falls back to mirroring the agent's own `job_output`
 *   tool results as they stream through the session event log
 *   ({@link BackgroundJobStore.onOutputSeen}).
 * - Jobs are process-local and owner-fenced. `list(agent)` returns exactly
 *   the jobs the current conversation owns (plus unowned ones); a job that
 *   disappears while live was teardown-cancelled (owner disposal / session
 *   swap) and is frozen as `killed` so no transcript card ticks forever.
 *
 * @module jobs
 */

/** Terminal / live lifecycle states, mirrored from the registry contract. */
export type BackgroundJobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed'

/** One bounded timeline occurrence of a tracked job: lifecycle and
 * output-drain observations in arrival order, wall-clock stamped at receipt.
 * The store keeps a bounded ring per job, so this is an observation log, not
 * a complete history: entries older than the ring are gone and the panel
 * says "latest" rather than implying completeness. */
export interface JobTimelineEvent {
  readonly kind: 'started' | 'progress' | 'output' | 'gap' | 'stopping' | 'settled'
  readonly at: number
  /** The progress line (progress) or terminal detail (settled), when the
   *  event carries text. */
  readonly text?: string
  /** Bytes observed in this output drain (output events). */
  readonly bytes?: number
  /** The drain's channel label, when the kernel chunk carried one. */
  readonly channel?: BackgroundJobOutputChannel
}

/** One tracked job as the UI renders it. */
export interface BackgroundJobState {
  id: string
  kind: string
  label: string
  /** The full command that started the job, captured from the originating
   *  tool call's args (`command`/`text`); the registry label is the friendly
   *  description. Absent when the start ack never streamed through (replay
   *  without the tool card, subagent one-shot jobs, …). */
  command?: string
  status: BackgroundJobStatus
  detail?: string
  /** Live producer progress line (`3/10`, phase name); cleared at settle. */
  progress?: string
  startedAt: number
  finishedAt?: number
  /** Last-seen output tail, newest last. Mirrored from the kernel output
   *  ring when its event bus is reachable (non-consuming `readAt` with the
   *  UI's own byte cursor), falling back to `job_output` tool-result tails. */
  outputLines: BackgroundJobOutputLine[]
  /** Epoch ms of the last mirrored output read (receipt time). */
  lastOutputAt?: number
  /** Total output bytes observed through the kernel ring (`output.total`). */
  outputTotalBytes?: number
  /** True when bytes were dropped before the retained tail (ring eviction
   *  or producer gap) — the panel shows the loss banner. */
  outputDropped?: boolean
  /** Producer-retained spill files holding the complete output stream. */
  spillPaths?: readonly string[]
  /** Where the backend writes the job's output (as the backend reported
   *  it); the output tail is read from it while the job is on screen. */
  outputFile?: string
  /** Last producer progress line seen. The live `progress` is cleared at
   *  settle, but the focused detail keeps showing what the producer last
   *  said (with its observation time and the producer kind as the source). */
  lastProgress?: string
  /** When `lastProgress` was observed (receipt wall-clock). */
  lastProgressAt?: number
  /** Output discontinuities observed for this job (ring evictions and
   *  producer gaps). A count only: the bytes behind a gap are gone and are
   *  never estimated. */
  gapCount?: number
  /** Bounded observation timeline; undefined/empty for jobs
   *  whose history predates the store's lifetime (a resumed roster). */
  timeline?: readonly JobTimelineEvent[]
}

/**
 * Background-job row control (`/jobs` panel): cancellation with the same
 * authority the owning agent itself would use (`job_kill`). Returns false
 * when the jobs service is absent or the job is unknown/foreign.
 */
export interface JobControl {
  kill(id: string): boolean
  /**
   * The job's card or panel entry is on screen: keep its output tail fresh
   * (a backend whose output is read on demand polls at most once a second
   * while watched). Returns the unwatch; absent = the output is pushed.
   */
  watchOutput?(id: string): () => void
}
