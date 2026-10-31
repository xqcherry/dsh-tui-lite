import type { ModuleOwners } from '../module-runtime.js'
import type { RuntimeCommands } from '../module-runtime.js'

const dispatchers = new WeakMap<ModuleOwners, RuntimeCommands>()

/** Keep a revoked dispatcher installed so late continuations fail closed. */
export function bindChannelCommands(runtime: ModuleOwners, commands: RuntimeCommands): void {
  dispatchers.set(runtime, commands)
}

export function channelCommands(runtime: ModuleOwners): RuntimeCommands {
  return dispatchers.get(runtime) ?? {
    ...runtime.sessions.commands,
    ...runtime.settings.commands,
    ...runtime.composer.commands,
    ...runtime.transcript.commands,
    ...runtime.activity.commands,
    ...runtime.workbench.commands,
  }
}
