import { createModuleStore, type Publication, type MutableSnapshot } from '../../../shared/state/module-store.js'
import type { ComposerSnapshot, ComposerCommands } from '../state-contracts.js'
import type { ModuleLaunch } from '../../../shared/protocol/module-launch.js'

/** This module is the sole owner of these fields. Writers never reach the UI. */
export function createComposerModule(launch: ModuleLaunch, commands: ComposerCommands, publication: Publication) {
  const { options, input } = launch
  const owned = createModuleStore<MutableSnapshot<ComposerSnapshot>>({
    selection: undefined,
    cancelPending: false,
    pending: [],
  }, publication)
  return {
    store: owned.store,
    commands,
    ingress: { patch: owned.patch, update: owned.update, read: owned.read },
    dispose: owned.dispose,
  }
}
