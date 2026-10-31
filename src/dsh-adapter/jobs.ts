export type { BackgroundJobOutputChannel, BackgroundJobOutputLine, BackgroundJobState, BackgroundJobStatus, JobTimelineEvent } from '../shared/protocol/jobs.js'

import type { BackgroundJobSnapshot, KernelJobEvent, KernelJobOutputRead } from '../modules/activity/index.js'
export type { BackgroundJobSnapshot, KernelJobOutputEvent, KernelJobLifecycleEvent, KernelJobEvent, KernelJobChunk, KernelJobOutputRead } from '../modules/activity/index.js'
export { BackgroundJobStore, JOBS_MAX_TRACKED, JOBS_MAX_OUTPUT_LINES, JOBS_MAX_TIMELINE } from '../modules/activity/index.js'
export type { BackgroundJobEvents } from '../modules/activity/index.js'

/**
 * Duck-typed registry surface the channel consumes. `caller` is the owning
 * session id string (`Agent.id`): the kernel fence compares
 * `job.owner.id === caller`, so passing the Agent OBJECT matches nothing —
 * the id string is the only value that opens owned jobs.
 */
export interface JobsRuntime {
  /** Caller-owned + unowned job snapshots in registration order. */
  list(caller?: string): BackgroundJobSnapshot[]
  /** Request cancellation by id; resolves to 'requested'/'already-finished'. */
  kill(id: string, caller?: string, reason?: string): unknown
  /**
   * Kernel event bus (the real `JobRegistry.events` surface). Present on
   * modern kernels: lifecycle events re-read the roster, `output` events
   * pull `readAt` increments with the UI's own byte cursor. Absent on older
   * kernels and test doubles — the mirror falls back to `onJobsChanged` +
   * `job_output` tails.
   */
  events?: {
    subscribe(
      filter: { owner?: string; owners?: 'all' | 'scope' },
      listener: (event: KernelJobEvent) => void,
    ): () => void
  }
  /** Non-consuming ring read at an absolute byte offset (kernel `readAt`). */
  readAt?(id: string, from: number, caller?: string): KernelJobOutputRead
  /** Legacy push hooks; absent on the real registry, kept for old doubles. */
  onJobsChanged?(listener: (owner: unknown) => void): () => void
  onJobDone?(listener: (snapshot: BackgroundJobSnapshot, owner: unknown) => void): () => void
}

// The formatter is backend-neutral (src/channel/job-format.ts); re-exported
// here for the existing importers.
export { formatJobDuration } from '../shared/platform/job-format.js'
