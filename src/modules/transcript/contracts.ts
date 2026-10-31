import type { AgentStatus } from '../../shared/protocol/session.js'
import type { ContextOccupancy } from '../../shared/protocol/session.js'
import type { ChatRow } from '../../shared/protocol/transcript.js'

/** Explicit TranscriptPort capability; no access to unrelated client operations. */
export interface TranscriptPort {
  readonly rows: readonly ChatRow[]
  readonly olderHistory: boolean
  loadOlder(): number
  compact(): void
  exportSession(): string | null
  clear(): void
  readonly contextOccupancy: ContextOccupancy | undefined
  readonly contextWindow: number | undefined
  readonly working: boolean
  readonly cancelPending: boolean
  readonly status: AgentStatus | 'starting' | 'disposed'
  cancel(): void
  pushLocal(title: string, lines: readonly string[]): void
}

export type { PricingWindow } from './model/usage.js'

export type { ChannelProjection } from './model/projection.js'
