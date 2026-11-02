import { createCommandLifetime } from '../../../shared/lifecycle/module-commands.js'
import type { WorkbenchCommandHost } from '../contracts.js'
import { createModuleStore, type Publication, type MutableSnapshot } from '../../../shared/state/module-store.js'
import type { WorkbenchSnapshot, WorkbenchCommands } from '../state-contracts.js'
import type { ModuleLaunch } from '../../../shared/protocol/module-launch.js'

/** This module is the sole owner of these fields. Writers never reach the UI. */
export function createWorkbenchModule(launch: ModuleLaunch, publication: Publication) {
  const lifetime = createCommandLifetime<WorkbenchCommandHost>(publication)
  const owned = createModuleStore<MutableSnapshot<WorkbenchSnapshot>>({
    backendVersion: launch.options.backendVersion,
    notifications: [],
    commandList: [],
  }, publication)
  const commands = Object.freeze<WorkbenchCommands>({
    notify: (...args) => lifetime.call(host => host.notify(...args)),
    runExternalCommand: (...args) => lifetime.call(host => host.runExternalCommand(...args)),
    runExternalCommandOutcome: (...args) => lifetime.call(host => host.runExternalCommandOutcome(...args)),
    mcpStatus: (...args) => lifetime.call(host => host.mcpStatus(...args)),
    initWorkspace: (...args) => lifetime.call(host => host.initWorkspace(...args)),
    doctorInfo: (...args) => lifetime.call(host => host.doctorInfo(...args)),
  })
  return {
    connectHost: lifetime.connect,
    startCommands: lifetime.start,
    store: owned.store,
    commands,
    ingress: {
      setCommands(commandList: WorkbenchSnapshot['commandList']): void { owned.patch({ commandList: [...commandList] }) },
      addNotification(item: WorkbenchSnapshot['notifications'][number]): void { owned.update(draft => { draft.notifications.push(item) }) },
      removeNotification(id: number): void { owned.update(draft => { draft.notifications = draft.notifications.filter(item => item.id !== id) }) },
      read: owned.read,
    },
    dispose() { lifetime.dispose(); owned.dispose() },
  }
}
