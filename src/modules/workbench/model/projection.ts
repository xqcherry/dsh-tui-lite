import type { SessionEventIngress } from '../../sessions/contracts.js'
import type { SettingsProjectionIngress } from '../../settings/contracts.js'
import type { ComposerEventIngress } from '../../composer/contracts.js'
import type { ChannelProjectionDeps, ChannelProjection, TranscriptProjectionContext, TranscriptProjectionEffects } from '../../transcript/contracts.js'

export interface WorkbenchProjectionModules {
  readonly sessions: { readonly ingress: Pick<SessionEventIngress, 'projectionContext' | 'setWorking' | 'metadata' | 'setCompaction'> }
  readonly settings: { readonly ingress: SettingsProjectionIngress }
  readonly composer: { readonly ingress: Pick<ComposerEventIngress, 'clearCancellation'> }
  readonly transcript: { readonly ingress: {
    createProjection(context: TranscriptProjectionContext, effects: TranscriptProjectionEffects, deps: ChannelProjectionDeps): ChannelProjection
  } }
}

/** Module effects run synchronously at the reducer's existing event stages. */
export function createWorkbenchProjection(modules: WorkbenchProjectionModules, deps: ChannelProjectionDeps): ChannelProjection {
  return modules.transcript.ingress.createProjection({
    session: () => modules.sessions.ingress.projectionContext(),
    settings: () => modules.settings.ingress.projectionContext(),
  }, {
    clearCancellation: () => modules.composer.ingress.clearCancellation(),
    setWorking: working => modules.sessions.ingress.setWorking(working),
    sessionMetadata: event => modules.sessions.ingress.metadata(event),
    settingsMetadata: event => modules.settings.ingress.metadata(event),
    setCompaction: compaction => modules.sessions.ingress.setCompaction(compaction),
  }, deps)
}
