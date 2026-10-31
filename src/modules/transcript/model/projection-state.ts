import type { MutableSnapshot } from '../../../shared/state/module-store.js'
import type { TranscriptSnapshot } from '../state-contracts.js'
import type { CompactionStatus } from '../../../shared/protocol/session.js'
import type { AgentEvent } from '../../../shared/protocol/events.js'

export type ProjectionState = MutableSnapshot<TranscriptSnapshot>

type ProjectionPort<State extends object, Metadata extends AgentEvent = never> = {
  ingress: {
    read(): Readonly<State>
    update(work: (draft: MutableSnapshot<State>) => void): void
    metadata(event: Metadata): void
  }
}

/** Facts needed by normalized session events, independent of module commands. */
export interface ProjectionHost {
  readonly sessions: ProjectionPort<{
    working: boolean
    compaction: CompactionStatus | undefined
    sessionTitle: string
    agentPreset: string | undefined
    sessionColor: string
  }, Extract<AgentEvent, { type: 'session.title' | 'session.color' }>>
  readonly settings: ProjectionPort<{
    thinkingFold: 'preview' | 'full'
    model: string
    contextWindow: number | undefined
    reasoningEffort: string | undefined
  }, Extract<AgentEvent, { type: 'context.capacity' | 'session.ready' | 'model.changed' | 'effort.changed' | 'request.header' }>>
  readonly composer: { ingress: { read(): Readonly<{ cancelPending: boolean }>; update(work: (draft: { cancelPending: boolean }) => void): void } }
}
