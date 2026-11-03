import type { ActivityJobTarget, ActivityTranscriptTarget } from '../contracts.js'

/** Translate admitted task snapshots into activity facts and transcript presentation. */
export function createJobPresentation(activity: ActivityJobTarget, transcript: ActivityTranscriptTarget, deps: {
  current(): boolean
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
