import { createModuleStore, type Publication, type MutableSnapshot } from '../../../shared/state/module-store.js'
import type { WorkbenchSnapshot, WorkbenchCommands } from '../state-contracts.js'
import type { ModuleLaunch } from '../../../shared/protocol/module-launch.js'

/** This module is the sole owner of these fields. Writers never reach the UI. */
export function createWorkbenchModule(launch: ModuleLaunch, commands: WorkbenchCommands, publication: Publication) {
  const { options, input } = launch
  const owned = createModuleStore<MutableSnapshot<WorkbenchSnapshot>>({
    notifications: [],
    commandList: [],
  }, publication)
  return {
    store: owned.store,
    commands,
    ingress: { read: owned.read, patch: owned.patch, update: owned.update },
    dispose: owned.dispose,
  }
}
