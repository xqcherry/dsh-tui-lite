import { t } from '../../../shared/i18n.js'
import { formatJobDuration } from '../../../shared/platform/job-format.js'
import type { ActivityJobTarget, ActivityTranscriptTarget } from '../contracts.js'

/** Translate admitted task snapshots into activity facts and transcript presentation. */
export function createJobPresentation(activity: ActivityJobTarget, transcript: ActivityTranscriptTarget, deps: {
  current(): boolean
  notify(text: string, options?: { color?: 'success' | 'error' | 'warning'; timeoutMs?: number }): unknown
  emit(): void
}) {
  const syncRows = (): void => activity.ingress.batch(() => {
    if (!deps.current()) return
    const snapshot = store.snapshot()
    activity.ingress.setBackgroundJobs([...snapshot])
    for (const job of snapshot) {
      const view = {
        id: job.id,
        kind: job.kind,
        label: job.label,
        status: job.status,
        ...(job.detail === undefined ? {} : { detail: job.detail }),
        ...(job.progress === undefined ? {} : { progress: job.progress }),
        startedAt: job.startedAt,
        ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
        outputLines: job.outputLines,
      }
      transcript.ingress.upsertActivityRow(`job:${job.id}`, { kind: 'job', text: job.label, job: view })
    }
  })

  const store = activity.ingress.createJobs({
    onSettled(job) {
      deps.notify(
        t(job.status === 'completed' ? 'jobs-toast-completed' : job.status === 'failed' ? 'jobs-toast-failed' : 'jobs-toast-killed', {
          id: job.id,
          label: job.label,
          duration: formatJobDuration(job),
          detail: job.detail ?? '',
        }),
        { color: job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'warning', timeoutMs: 6000 },
      )
    },
    onChanged() {
      if (!deps.current()) return
      syncRows()
      if (deps.current()) deps.emit()
    },
  })

  const dropRows = (): void => { transcript.ingress.resetActivityRows('job') }
  const reset = (): void => { dropRows(); store.reset() }
  return { store, dropRows, reset }
}
