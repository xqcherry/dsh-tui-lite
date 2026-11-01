export type { SessionModeSpec } from './model/modes.js'

export type { SessionActions } from './model/actions-contract.js'

export type { SessionsSnapshot, SessionsCommands, SessionsBinding } from './state-contracts.js'

export type { NewSessionOpener, NewSessionPlan, NewSessionTarget, SessionHandoffHost } from './model/session-switch.js'

export type SessionMetadataEvent = Extract<import('../../shared/protocol/events.js').AgentEvent, { type: 'session.title' | 'session.color' }>

/** Session-owned writes used by foreground event coordination. */
export interface SessionEventIngress {
  projectionContext(): Readonly<Pick<import('./state-contracts.js').SessionsSnapshot, 'working' | 'compaction' | 'agentPreset'>>
  setStatus(status: 'idle' | 'running' | 'disposed'): void
  setWorking(working: boolean): void
  setCompaction(compaction: import('../../shared/protocol/session.js').CompactionStatus | undefined): void
  metadata(event: SessionMetadataEvent): void
  adoptIdentity(identity: { readonly status: 'idle' | 'running' | 'disposed'; readonly agentId: string; readonly sessionId: string; readonly agentPreset: string | undefined }): void
  adoptWorkspace(cwd: string, displayCwd?: string): void
  resetSessionState(): void
}

/** Host capabilities consumed by the sessions command owner. */
export type SessionsCommandHost = import('./state-contracts.js').SessionsCommands
