import type { ModelRoute } from './modelRoute.js'
import { createModuleStore, type Publication, type MutableSnapshot } from '../../../shared/state/module-store.js'
import type { SettingsSnapshot, SettingsCommands } from '../state-contracts.js'
import type { ModuleLaunch } from '../../../shared/protocol/module-launch.js'
import type { AgentEvent } from '../../../shared/protocol/events.js'

/** This module is the sole owner of these fields. Writers never reach the UI. */
export function createSettingsModule(launch: ModuleLaunch, commands: SettingsCommands, publication: Publication) {
  const { options, input } = launch
  const owned = createModuleStore<MutableSnapshot<SettingsSnapshot>>({
    model: options.model,
    provider: options.provider,
    configuredProvider: options.configuredProvider,
    configuredModel: options.configuredModel,
    configuredPreset: options.configuredPreset,
    contextWindow: undefined,
    reasoningEffort: options.effort,
    effortLevels: undefined,
    diffLayout: 'auto',
    thinkingFold: 'preview',
    jobGroupFold: 'auto',
    toolBackground: 'none',
    promptSessionLabel: false,
    expandEditor: false,
  }, publication)
  return {
    store: owned.store,
    commands,
    ingress: {
      setThinkingFold(thinkingFold: SettingsSnapshot['thinkingFold']): void { owned.patch({ thinkingFold }) },
      projectionContext: owned.read,
      adoptRoute(route: ModelRoute | undefined): void { if (route !== undefined) owned.patch(route) },
      resetSessionCapabilities(): void { owned.patch({ contextWindow: undefined, effortLevels: undefined, reasoningEffort: undefined }) },
      setReasoningEffort(reasoningEffort: string | undefined): void { owned.patch({ reasoningEffort }) },
      setEffortLevels(effortLevels: readonly string[] | undefined): void { owned.patch({ effortLevels }) },
      setContextWindow(contextWindow: number | undefined): void { owned.patch({ contextWindow }) },
      read: owned.read, patch: owned.patch, update: owned.update,
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
    dispose: owned.dispose,
  }
}
