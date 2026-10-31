import type { SessionSummary } from '../../shared/protocol/session-catalog.js'
import type { ResumeResult } from '../../shared/protocol/session.js'

/** Explicit SessionsPort capability; no access to unrelated client operations. */
export interface SessionsPort {
  readonly agentId: string
  readonly sessionId: string
  readonly agentBindingGeneration: number
  readonly cwd: string
  readonly displayCwd: string
  readonly sessionTitle: string
  readonly sessionColor: string
  newSession(): Promise<boolean>
  resumeTo(sessionId: string): Promise<ResumeResult>
  listSessions(onEnriched?: (summary: SessionSummary) => void, onPartial?: (rows: readonly SessionSummary[]) => void): Promise<readonly SessionSummary[]>
  renameSession(title: string): void
}

export type { SessionModeSpec } from './model/modes.js'

export type { SessionActions } from './model/actions-contract.js'
