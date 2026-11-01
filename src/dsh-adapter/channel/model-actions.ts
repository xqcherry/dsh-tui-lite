import { publishRuntime, type ModuleOwners } from '../module-runtime.js'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Notify } from '../../shared/protocol/notifications.js'
import { createSettingsModelActions } from '../../modules/settings/index.js'
import type { SettingsModelCatalog, SettingsModelState } from '../../modules/settings/contracts.js'
import type { ChannelBinding } from './binding.js'

/** Official catalog and model-selection resources implement the settings host. */
export function createModelActions(ctx: Context, state: Pick<ModuleOwners, 'settings' | 'sessions' | 'transcript' | 'publication'>, deps: {
  owner: { current(): boolean }
  binding: Pick<ChannelBinding, 'capture' | 'isCurrent'>
  selection: ModelSelectionRef
  initialEffort?: string
  notify: Notify
  agent(): Agent
  checkContextWarning(): void
}) {
  const actions = createSettingsModelActions(state.settings.ingress, {
    models: ctx.get('llm') as SettingsModelCatalog | undefined,
    current: deps.owner.current,
    capture: deps.binding.capture,
    bindingCurrent: deps.binding.isCurrent,
    pinnedEffort: () => deps.selection.current?.reasoningEffort,
    pin: value => {
      deps.selection.current = {
        provider: value.provider, model: value.model,
        ...(value.effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(value.effort) }),
      }
    },
    notify: deps.notify,
    publish: () => publishRuntime(state),
    checkContextWarning: deps.checkContextWarning,
  }, deps.initialEffort)
  return { ...actions, selection: deps.selection }
}
