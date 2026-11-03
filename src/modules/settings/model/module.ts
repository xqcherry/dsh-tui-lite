import { createCommandLifetime } from '../../../shared/lifecycle/module-commands.js'
import type { SettingsCommandHost } from '../contracts.js'
import { createModuleStore, type Publication, type MutableSnapshot } from '../../../shared/state/module-store.js'
import type { SettingsSnapshot, SettingsCommands } from '../state-contracts.js'
import type { ModuleLaunch } from '../../../shared/protocol/module-launch.js'
import type { ModelRoute } from './modelRoute.js'
import type { AgentEvent } from '../../../shared/protocol/events.js'

/** This module is the sole owner of these fields. Writers never reach the UI. */
export function createSettingsModule(launch: ModuleLaunch, publication: Publication) {
  const lifetime = createCommandLifetime<SettingsCommandHost>(publication)
  const { options } = launch
  const owned = createModuleStore<MutableSnapshot<SettingsSnapshot>>({
    model: options.model,
    provider: options.provider,
    configuredProvider: options.configuredProvider,
    configuredModel: options.configuredModel,
    configuredPreset: options.configuredPreset,
    contextWindow: undefined,
    reasoningEffort: options.effort,
    effortLevels: undefined,
    thinkingFold: 'preview',
    promptSessionLabel: false,
    expandEditor: false,
  }, publication)
  const commands = Object.freeze<SettingsCommands>({
    switchModel: (...args) => lifetime.call(host => host.switchModel(...args)),
    listEfforts: (...args) => lifetime.call(host => host.listEfforts(...args)),
    setEffort: (...args) => lifetime.call(host => host.setEffort(...args)),
    setDefaultEffort: (...args) => lifetime.call(host => host.setDefaultEffort(...args)),
    listModels: (...args) => lifetime.call(host => host.listModels(...args)),
    listProviders: (...args) => lifetime.call(host => host.listProviders(...args)),
    invalidateModelCompletion: (...args) => lifetime.call(host => host.invalidateModelCompletion(...args)),
    describeCredential: (...args) => lifetime.call(host => host.describeCredential(...args)),
    providerSetup: (...args) => lifetime.call(host => host.providerSetup(...args)),
    oauthProviderStatuses: (...args) => lifetime.call(host => host.oauthProviderStatuses(...args)),
    listSkills: (...args) => lifetime.call(host => host.listSkills(...args)),
  })
  return {
    connectHost: lifetime.connect,
    startCommands: lifetime.start,
    store: owned.store,
    commands,
    ingress: {
      setThinkingFold(thinkingFold: SettingsSnapshot['thinkingFold']): void { owned.patch({ thinkingFold }) },
      read: owned.read,
      projectionContext: owned.read,
      setReasoningEffort(reasoningEffort: string | undefined): void { owned.patch({ reasoningEffort }) },
      setEffortLevels(effortLevels: readonly string[] | undefined): void { owned.patch({ effortLevels }) },
      setContextWindow(contextWindow: number | undefined): void { owned.patch({ contextWindow }) },
      adoptRoute(route: ModelRoute | undefined): void { if (route !== undefined) owned.patch(route) },
      resetSessionCapabilities(): void { owned.patch({ contextWindow: undefined, effortLevels: undefined, reasoningEffort: undefined }) },
      metadata(event: Extract<AgentEvent, { type: 'context.capacity' | 'session.ready' | 'model.changed' | 'effort.changed' | 'request.header' }>): void {
        switch (event.type) {
          case 'context.capacity':
            owned.patch({ contextWindow: event.contextWindow })
            return
          case 'session.ready':
            owned.patch({
              ...(event.model !== '' ? { model: event.model } : {}),
              ...(event.contextWindow !== undefined ? { contextWindow: event.contextWindow } : {}),
            })
            return
          case 'model.changed':
            if (event.model !== '') owned.patch({ model: event.model })
            return
          case 'effort.changed':
            // Null means the backend restored its default effort.
            owned.patch({ reasoningEffort: event.effort ?? undefined })
            return
          case 'request.header':
            if (event.effort !== undefined) owned.patch({ reasoningEffort: event.effort })
            return
        }
      },
    },
    dispose() { lifetime.dispose(); owned.dispose() },
  }
}
