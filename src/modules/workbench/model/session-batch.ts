import type { Publication } from '../../../shared/state/module-store.js'
import type { AgentEvent, AgentEventMeta, AgentEventOf } from '../../../shared/protocol/events.js'
import type { ComposerEventIngress } from '../../composer/contracts.js'
import type { SessionEventIngress } from '../../sessions/contracts.js'
import type { TranscriptSessionIngress, ChannelProjection } from '../../transcript/contracts.js'

/**
 * The one session-batch writer path, shared by every channel composition:
 * binding-generation fence over the whole batch, session status and
 * pending-queue bookkeeping, compaction-progress gating, then the shared
 * projector and the renderer wake the backend asked for.
 */
export function createSessionBatchRouter(deps: {
  sessions: Pick<SessionEventIngress, 'projectionContext' | 'setStatus' | 'setWorking'>
  composer: Pick<ComposerEventIngress, 'clearCancellation' | 'retirePending'>
  transcript: Pick<TranscriptSessionIngress, 'releaseActiveTools'>
  publication: Pick<Publication, 'batch'>
  publish(mode?: 'immediate' | 'stream'): void
  projector: ChannelProjection
  /** Drop channel-side context attached to a discarded input (DSH pre-step
   *  attachments); absent where nothing is ever attached. */
  retireAttachment?(messageId: string): void
  /** The backend reset the conversation in place (`session.reset`, live):
   *  the events before it in the batch are projected first, those after it
   *  land on the cleared view. Absent = the event is projected (ignored). */
  onReset?(event: AgentEventOf<'session.reset'>): void
  warn(message: string): void
}) {
  const reconcileRetiredProjection = (status: 'idle' | 'disposed'): void => {
    if (!deps.sessions.projectionContext().working) return
    deps.warn(`dsh-tui: agent became ${status} while the channel still projected an open turn; releasing volatile UI gates`)
    deps.composer.clearCancellation()
    deps.sessions.setWorking(false)
    deps.transcript.releaseActiveTools()
    deps.projector.settleStreaming()
    deps.projector.updateSpinnerMode()
  }

  /** `session.status` as the backend reports it. */
  const applyStatus = (status: 'idle' | 'running' | 'requires-action' | 'disposed'): void => {
    if (status === 'disposed') {
      deps.sessions.setStatus('disposed')
      reconcileRetiredProjection('disposed')
      deps.publish()
      return
    }
    // The channel's status is idle/running only; a parked prompt is mid-turn.
    deps.sessions.setStatus(status === 'idle' ? 'idle' : 'running')
    if (status === 'idle') reconcileRetiredProjection('idle')
    deps.publish()
  }
  /**
   * The backend queue lost inputs. A claim and a discard both retire the
   * pending preview, but only a discard retires an attached-context entry. A
   * claim fires while the loop claims the batch, before the resident
   * `agent/pre-step` listener appends the attachment, so retiring there would
   * delete the context before it is ever injected.
   */
  const applyPending = (event: AgentEventOf<'pending.changed'>): void => {
    for (const messageId of event.discarded ?? []) deps.retireAttachment?.(messageId)
    // A discard of a docked preview only drops the backend copy. The dock
    // (where an interrupt parks inputs on the channel side) owns the row, so
    // it stays until sent (`deliverDocked`) or retracted. A claim always
    // retires the row: a fallback backend that kept its queue ran it.
    const dockedDiscards = new Set(event.discarded ?? [])
    for (const messageId of [...event.claimed ?? [], ...event.discarded ?? []]) {
      if (deps.composer.retirePending(messageId, dockedDiscards.has(messageId))) deps.publish()
    }
  }

  /** Monotonic count of live turns that started on a bound session (`/new`
   *  compares it across its open: a whole turn may come and go meanwhile). */
  let turnStarts = 0

  const route = (batch: readonly AgentEvent[], meta: AgentEventMeta, current: () => boolean): void => {
    // The generation fence covers the whole batch, whatever it carries. A
    // callback retained past a rebind (an in-flight dispatch, a compaction
    // summary stream that outlived the binding it started under) must never
    // write the replacement session's transcript.
    if (!current()) return
    let admitted: AgentEvent[] | undefined
    let progressOnly = batch.length > 0
    for (const [index, event] of batch.entries()) {
      switch (event.type) {
        case 'turn.start':
          if (!meta.replay) turnStarts += 1
          break
        case 'session.status':
          applyStatus(event.status)
          break
        case 'pending.changed':
          applyPending(event)
          break
        case 'compaction.progress':
          // Summary output only advances a compaction row that is open; a
          // stale stream after the row closed finds nothing to advance.
          if (deps.sessions.projectionContext().compaction === undefined) {
            admitted ??= batch.slice(0, index)
            continue
          }
          break
        default:
          break
      }
      if (event.type !== 'compaction.progress') progressOnly = false
      admitted?.push(event)
    }
    const events = admitted ?? batch
    if (progressOnly) {
      // Pure summary progress: frame-coalesced like the stream it counts.
      if (events.length === 0) return
      deps.projector.apply(events, meta)
      deps.publish('stream')
      return
    }
    // The one writer of the foreground transcript. A live conversation
    // reset splits the batch: what came before it is projected first.
    const onReset = meta.replay ? undefined : deps.onReset
    if (onReset !== undefined && events.some(event => event.type === 'session.reset')) {
      let start = 0
      events.forEach((event, index) => {
        if (event.type !== 'session.reset') return
        if (index > start) deps.projector.apply(events.slice(start, index), meta)
        onReset(event)
        start = index + 1
      })
      if (start < events.length) deps.projector.apply(events.slice(start), meta)
    } else {
      deps.projector.apply(events, meta)
    }
    if (meta.wake === 'frame') deps.publish('stream')
    else if (meta.wake !== 'none') deps.publish()
  }

  return {
    route(batch: readonly AgentEvent[], meta: AgentEventMeta, current: () => boolean): void {
      const progressOnly = batch.length > 0 && batch.every(event => event.type === 'compaction.progress')
      const mode = progressOnly || meta.wake === 'frame' ? 'stream'
        : meta.wake === 'none' ? 'silent' : 'immediate'
      deps.publication.batch(() => route(batch, meta, current), mode)
    },
    reconcileRetiredProjection,
    turnStarts: (): number => turnStarts,
  }
}
