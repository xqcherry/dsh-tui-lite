export type { PricingWindow } from './model/usage.js'

export type { ChannelProjection } from './model/projection.js'
export type { ChannelProjectionDeps } from './model/projection.js'

export type { TranscriptSnapshot, TranscriptCommands, TranscriptBinding } from './state-contracts.js'

/** Immutable facts consulted during projection, including uncommitted batch effects. */
export interface TranscriptProjectionContext {
  settings(): Readonly<{
    thinkingFold: 'preview' | 'full'
    model: string
    reasoningEffort: string | undefined
  }>
  session(): Readonly<{
    agentPreset: string | undefined
    compaction: import('../../shared/protocol/session.js').CompactionStatus | undefined
  }>
}

/** Synchronous effects executed at the original event stage by the workbench. */
export interface TranscriptProjectionEffects {
  clearCancellation(): void
  setWorking(working: boolean): void
  settingsMetadata(event: Extract<import('../../shared/protocol/events.js').AgentEvent, { type: 'context.capacity' | 'session.ready' | 'model.changed' | 'effort.changed' | 'request.header' }>): void
  sessionMetadata(event: Extract<import('../../shared/protocol/events.js').AgentEvent, { type: 'session.title' | 'session.color' }>): void
  setCompaction(compaction: import('../../shared/protocol/session.js').CompactionStatus | undefined): void
}

/** Transcript reset phases bracket activity reducers that still inspect old facts. */
export interface TranscriptSessionIngress {
  clearLoadedContext(): void
  resetRows(): void
  resetSessionState(): void
  releaseActiveTools(): void
}

/** Host capabilities consumed by the transcript command owner. */
export type TranscriptCommandHost = import('./state-contracts.js').TranscriptCommands
