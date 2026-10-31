import { completeTuiCommands, isCommandCompletionToken, type CommandCompletionNode } from '../../app/commands/catalog.js'
import type { ChannelState } from './types.js'

/** Complete only supported chat controls and host commands. */
export function createCommandCompletions(deps: {
  state: () => ChannelState
  commandTrees?: { children(path: readonly string[]): readonly CommandCompletionNode[] }
  model: {
    warmModelNodes(): void
    modelNodes(): readonly CommandCompletionNode[]
    warmEffortLevels(): void
  }
}) {
  return (input: string) => {
    const state = deps.state()
    return completeTuiCommands(input, state.commandList, path => {
      if (path.length === 1 && path[0] === 'model') {
        deps.model.warmModelNodes()
        return deps.model.modelNodes()
      }
      if (path.length === 1 && path[0] === 'effort') {
        deps.model.warmEffortLevels()
        return (state.effortLevels ?? []).map(id => ({ name: id, description: 'Reasoning effort', ...(state.reasoningEffort === id ? { tag: 'current' } : {}) }))
      }
      if (path.length === 1 && path[0] === 'permission') {
        const snapshot = state.permissionPresets()
        if (snapshot.options.length > 0) {
          return snapshot.options.filter(option => isCommandCompletionToken(option.value)).map(option => ({
            name: option.value, description: option.description ?? option.name,
            ...(option.value === 'read-only' ? { descriptionKey: 'permission-preset-readonly-desc' } : option.value === 'workspace-write' ? { descriptionKey: 'permission-preset-workspace-write-desc' } : option.value === 'danger-full-access' ? { descriptionKey: 'permission-preset-full-access-desc' } : {}),
            ...(snapshot.current?.kind === 'preset' && snapshot.current.value === option.value ? { tag: 'current' } : {}),
          }))
        }
        return []
      }
      return deps.commandTrees?.children(path) ?? []
    })
  }
}
