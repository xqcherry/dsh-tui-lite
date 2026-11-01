import type { SessionEventIngress } from '../../sessions/contracts.js'
import type { ComposerEventIngress } from '../../composer/contracts.js'
import type { TranscriptSessionIngress } from '../../transcript/contracts.js'
import type { ActivitySessionIngress } from '../../activity/contracts.js'

/** Only owned reset operations cross feature boundaries. */
export interface SessionResetPorts {
  readonly sessions: { readonly ingress: Pick<SessionEventIngress, 'resetSessionState'> }
  readonly composer: { readonly ingress: Pick<ComposerEventIngress, 'resetSessionState'> }
  readonly transcript: { readonly ingress: Pick<TranscriptSessionIngress, 'resetRows' | 'resetSessionState'> }
  readonly activity: { readonly ingress: ActivitySessionIngress }
}

/** Preserve the projector → empty rows → child/job reset callback ordering. */
export function resetSessionProjection(
  modules: SessionResetPorts,
  rowIds: { value: number },
  resetProjector: () => void,
  resetSubagents: () => void,
  resetJobs: () => void,
): void {
  resetProjector()
  rowIds.value = 0
  modules.transcript.ingress.resetRows()
  resetSubagents()
  resetJobs()
  modules.transcript.ingress.resetSessionState()
  modules.composer.ingress.resetSessionState()
  modules.sessions.ingress.resetSessionState()
  modules.activity.ingress.resetSessionCost()
}
