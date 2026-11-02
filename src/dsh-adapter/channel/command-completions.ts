import type { LocalCommand } from '../../shared/protocol/commands.js'
import type { SettingsSnapshot } from '../../modules/settings/contracts.js'
import type { PermissionPresetSnapshot } from '../../shared/protocol/models.js'
import { completeTuiCommands, isCommandCompletionToken, LOCAL_COMMAND_CHILDREN, type CommandCompletionNode } from '../../shared/commands.js'

/** Complete only supported chat controls and host commands. */
export function createCommandCompletions(deps: {
  commands(): readonly LocalCommand[]
  settings(): Readonly<Pick<SettingsSnapshot, 'effortLevels' | 'reasoningEffort'>>
  permissionPresets(): PermissionPresetSnapshot
  commandTrees?: { children(path: readonly string[]): readonly CommandCompletionNode[] }
  model: {
    warmModelNodes(): void
    modelNodes(): readonly CommandCompletionNode[]
    warmEffortLevels(): void
  }
}) {
  return (input: string) => {
    return completeTuiCommands(input, deps.commands(), path => {
      if (path.length === 1 && path[0] === 'model') {
        deps.model.warmModelNodes()
        return deps.model.modelNodes()
      }
      if (path.length === 1 && path[0] === 'effort') {
        deps.model.warmEffortLevels()
        return (deps.settings().effortLevels ?? []).map(id => ({ name: id, description: 'Reasoning effort', ...(deps.settings().reasoningEffort === id ? { tag: 'current' } : {}) }))
      }
      if (path.length === 1 && path[0] === 'permission') {
        const snapshot = deps.permissionPresets()
        if (snapshot.options.length > 0) {
          return snapshot.options.filter(option => isCommandCompletionToken(option.value)).map(option => ({
            name: option.value, description: option.description ?? option.name,
            ...(option.value === 'read-only' ? { descriptionKey: 'permission-preset-readonly-desc' } : option.value === 'workspace-write' ? { descriptionKey: 'permission-preset-workspace-write-desc' } : option.value === 'danger-full-access' ? { descriptionKey: 'permission-preset-full-access-desc' } : {}),
            ...(snapshot.current?.kind === 'preset' && snapshot.current.value === option.value ? { tag: 'current' } : {}),
          }))
        }
        return []
      }
      return LOCAL_COMMAND_CHILDREN[path.join(' ')] ?? deps.commandTrees?.children(path) ?? []
    })
  }
}
