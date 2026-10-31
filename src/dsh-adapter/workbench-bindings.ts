import type { WorkbenchModules } from '../modules/workbench/contracts.js'
import type { RuntimeModules } from './module-runtime.js'
import { channelOwnerCurrent } from '../shared/lifecycle/owner.js'
import { createChannelReadView } from '../shared/state/read-view.js'
import { bindChannelCommands } from './channel/commands.js'

/** Hide adapter ingress and lifecycle capabilities at the renderer boundary. */
export function createWorkbenchBindings(runtime: RuntimeModules): WorkbenchModules {
  const project = createChannelReadView(() => {
    if (!channelOwnerCurrent(runtime)) throw new Error('dsh-tui: Channel lifetime has ended')
  })
  const binding = <T extends { readonly store: unknown; readonly commands: object }>(module: T): Pick<T, 'store' | 'commands'> =>
    Object.freeze({ store: module.store, commands: project({ ...module.commands }, 0) })
  const bindings = Object.freeze({
    activity: binding(runtime.activity),
    composer: binding(runtime.composer),
    sessions: binding(runtime.sessions),
    settings: binding(runtime.settings),
    transcript: binding(runtime.transcript),
    workbench: binding(runtime.workbench),
  })
  bindChannelCommands(runtime, {
    ...bindings.activity.commands,
    ...bindings.composer.commands,
    ...bindings.sessions.commands,
    ...bindings.settings.commands,
    ...bindings.transcript.commands,
    ...bindings.workbench.commands,
  })
  return bindings
}
