import type { SessionModeSpec } from '../../shared/protocol/display.js'
import type { AgentStatus } from '../../shared/protocol/session.js'
import type { CompactionStatus } from '../../shared/protocol/session.js'
import type { AgentCapabilities } from '../../shared/protocol/agent-capabilities.js'
import type { PreviewEntry } from '../../shared/protocol/session-catalog.js'
import type { SessionSummary } from '../../shared/protocol/session-catalog.js'
import type { ResumeResult } from '../../shared/protocol/session.js'
import type { PermissionPresetSnapshot } from '../../shared/protocol/models.js'
import type { ReadableStore } from '../../shared/state/module-store.js'

export interface SessionsSnapshot {
  readonly status: AgentStatus | 'starting' | 'disposed'
  readonly sessionTitle: string
  readonly sessionColor: string
  readonly agentId: string
  readonly sessionId: string
  readonly agentBindingGeneration: number
  readonly cwd: string
  readonly displayCwd: string
  readonly gitBranch: string | undefined
  readonly working: boolean
  readonly compaction: CompactionStatus | undefined
  readonly mode: SessionModeSpec
  readonly modeIndex: number
  readonly agentPreset: string | undefined
}

export interface SessionsCommands {
  resumeTo(sessionId: string): Promise<ResumeResult>
  newSession(): Promise<boolean>
  cachedSessions(): readonly SessionSummary[] | undefined
  listSessions(onEnriched?: (summary: SessionSummary) => void, onPartial?: (rows: readonly SessionSummary[]) => void): Promise<readonly SessionSummary[]>
  previewSession(sessionId: string): Promise<readonly PreviewEntry[]>
  setResumeTarget(sessionId: string): void
  renameSession(title: string): void
  /** Persist a named session color; an empty string restores the default. */
  setSessionColor(color: string): void
  deleteSession(sessionId: string): Promise<boolean>
  renameSessionTo(sessionId: string, title: string): Promise<boolean>
  capabilities(): AgentCapabilities
  cycleMode(): Promise<void>
  permissionPresets(): PermissionPresetSnapshot
  runPermissionPreset(name: string): Promise<boolean>
}

export interface SessionsBinding {
  readonly store: ReadableStore<SessionsSnapshot>
  readonly commands: Readonly<SessionsCommands>
}
