import { createModuleStore, type Publication, type MutableSnapshot } from '../../../shared/state/module-store.js'
import type { SessionsSnapshot, SessionsCommands } from '../state-contracts.js'
import type { ModuleLaunch } from '../../../shared/protocol/module-launch.js'
import type { AgentEvent } from '../../../shared/protocol/events.js'

/** This module is the sole owner of these fields. Writers never reach the UI. */
export function createSessionsModule(launch: ModuleLaunch, commands: SessionsCommands, publication: Publication) {
  const { options, input } = launch
  const owned = createModuleStore<MutableSnapshot<SessionsSnapshot>>({
    status: 'starting',
    sessionTitle: '',
    sessionColor: '',
    agentId: input.agentId,
    sessionId: input.sessionId,
    agentBindingGeneration: 0,
    cwd: options.cwd,
    displayCwd: input.cwdDescription,
    gitBranch: undefined,
    working: false,
    compaction: undefined,
    mode: input.mode,
    modeIndex: 0,
    agentPreset: options.agentPreset,
  }, publication)
  return {
    store: owned.store,
    commands,
    ingress: {
      patch: owned.patch, update: owned.update, read: owned.read,
      metadata(event: Extract<AgentEvent, { type: 'session.title' | 'session.color' }>): void {
        switch (event.type) {
          case 'session.title':
            owned.patch({ sessionTitle: event.title })
            return
          case 'session.color':
            // Durable last-write wins; an empty color restores the default.
            owned.patch({ sessionColor: event.color })
            return
        }
      },
    },
    dispose: owned.dispose,
  }
}
