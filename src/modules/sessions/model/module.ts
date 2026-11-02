import { createCommandLifetime } from '../../../shared/lifecycle/module-commands.js'
import type { SessionsCommandHost } from '../contracts.js'
import { createModuleStore, type Publication, type MutableSnapshot } from '../../../shared/state/module-store.js'
import type { SessionsSnapshot, SessionsCommands } from '../state-contracts.js'
import type { ModuleLaunch } from '../../../shared/protocol/module-launch.js'
import type { SessionEventIngress } from '../contracts.js'
import type { AgentEvent } from '../../../shared/protocol/events.js'
import { readSessionColorPref } from './sessionColorPrefs.js'

/** This module is the sole owner of these fields. Writers never reach the UI. */
export function createSessionsModule(launch: ModuleLaunch, publication: Publication) {
  const lifetime = createCommandLifetime<SessionsCommandHost>(publication)
  const { options, input } = launch
  const owned = createModuleStore<MutableSnapshot<SessionsSnapshot>>({
    status: 'starting',
    sessionTitle: '',
    sessionColor: readSessionColorPref() ?? '',
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
  const commands = Object.freeze<SessionsCommands>({
    resumeTo: (...args) => lifetime.call(host => host.resumeTo(...args)),
    newSession: (...args) => lifetime.call(host => host.newSession(...args)),
    cachedSessions: (...args) => lifetime.call(host => host.cachedSessions(...args)),
    listSessions: (...args) => lifetime.call(host => host.listSessions(...args)),
    previewSession: (...args) => lifetime.call(host => host.previewSession(...args)),
    setResumeTarget: (...args) => lifetime.call(host => host.setResumeTarget(...args)),
    setSessionColor: (...args) => lifetime.call(host => host.setSessionColor(...args)),
    renameSession: (...args) => lifetime.call(host => host.renameSession(...args)),
    deleteSession: (...args) => lifetime.call(host => host.deleteSession(...args)),
    renameSessionTo: (...args) => lifetime.call(host => host.renameSessionTo(...args)),
    capabilities: (...args) => lifetime.call(host => host.capabilities(...args)),
    cycleMode: (...args) => lifetime.call(host => host.cycleMode(...args)),
    permissionPresets: (...args) => lifetime.call(host => host.permissionPresets(...args)),
    runPermissionPreset: (...args) => lifetime.call(host => host.runPermissionPreset(...args)),
  })
  return {
    connectHost: lifetime.connect,
    startCommands: lifetime.start,
    store: owned.store,
    commands,
    ingress: {
      setIdentity(agentId: string, sessionId: string): void { owned.patch({ agentId, sessionId }) },
      setBindingGeneration(agentBindingGeneration: number): void { owned.patch({ agentBindingGeneration }) },
      setMode(mode: SessionsSnapshot['mode'], modeIndex = owned.read().modeIndex): void { owned.patch({ mode, modeIndex }) },
      setTitle(sessionTitle: string): void { owned.patch({ sessionTitle }) },
      setGitBranch(gitBranch: string | undefined): void { owned.patch({ gitBranch }) },
      read: owned.read,
      projectionContext: owned.read,
      adoptIdentity(identity: Parameters<SessionEventIngress['adoptIdentity']>[0]): void { owned.patch(identity) },
      adoptWorkspace(cwd: string, displayCwd = cwd): void { owned.patch({ cwd, displayCwd }) },
      setStatus(status: 'idle' | 'running' | 'disposed'): void { owned.patch({ status }) },
      setWorking(working: boolean): void { owned.patch({ working }) },
      setCompaction(compaction: SessionsSnapshot['compaction']): void { owned.patch({ compaction }) },
      resetSessionState(): void {
        // A freshly adopted session has no replay yet: start from the last
        // `/color` default; a session's own `session/color` event overrides it
        // during replay.
        owned.patch({ sessionTitle: '', sessionColor: readSessionColorPref() ?? '', working: false, compaction: undefined })
      },
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
    dispose() { lifetime.dispose(); owned.dispose() },
  }
}
