import type { SessionEventIngress } from '../../sessions/contracts.js'
import type { SettingsSessionIngress } from '../../settings/contracts.js'
import type { TranscriptSessionIngress } from '../../transcript/contracts.js'
import { resetSessionProjection, type SessionResetPorts } from './session-reset.js'

export interface SessionAdoptionPorts extends SessionResetPorts {
  readonly sessions: { readonly ingress: Pick<SessionEventIngress, 'resetSessionState' | 'adoptIdentity'> }
  readonly settings: { readonly ingress: SettingsSessionIngress }
  readonly transcript: { readonly ingress: Pick<TranscriptSessionIngress, 'resetRows' | 'resetSessionState' | 'clearLoadedContext'> }
}

/** Coordinates module-owned reset phases using only data about the adopted session. */
export function resetAdoptedSession(
  modules: SessionAdoptionPorts,
  facts: {
    readonly identity: Parameters<SessionEventIngress['adoptIdentity']>[0]
    readonly route: Parameters<SettingsSessionIngress['adoptRoute']>[0]
    readonly clearLoadedContext: boolean
  },
  reset: { rowIds: { value: number }; resetProjector(): void; resetSubagents(): void; resetJobs(): void },
): void {
  resetSessionProjection(modules, reset.rowIds, reset.resetProjector, reset.resetSubagents, reset.resetJobs)
  modules.sessions.ingress.adoptIdentity(facts.identity)
  modules.settings.ingress.adoptRoute(facts.route)
  if (facts.clearLoadedContext) modules.transcript.ingress.clearLoadedContext()
  modules.settings.ingress.resetSessionCapabilities()
}
