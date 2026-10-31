import type { Context } from '@deepseek-ai/cordis'
import { createSessionHandoff } from '../../../modules/sessions/index.js'
import type { NewSessionOpener as SessionOpener, NewSessionPlan as SessionPlan } from '../../../modules/sessions/contracts.js'
import type { DshSession } from '../../backend/session.js'
import type { ChannelBinding } from '../binding.js'
import type { ModuleOwners, RuntimeCommands } from '../../module-runtime.js'

export type { NewSessionTarget } from '../../../modules/sessions/contracts.js'
export type NewSessionOpener = SessionOpener<DshSession>
export type NewSessionPlan = SessionPlan<DshSession>

/** DSH binding and resources implement the session module's narrow handoff host. */
export function createSessionSwitch(_ctx: Context, deps: {
  owner: { current(): boolean }
  binding: Pick<ChannelBinding, 'session' | 'capture' | 'isCurrent' | 'prepare' | 'abandon' | 'adopt'>
  state(): Pick<ModuleOwners, 'sessions' | 'composer'>
  notify: RuntimeCommands['notify']
  resetIdeSelection(): void
  clearStagedImages(): void
  opener(): NewSessionOpener | undefined
  activity(): { readonly inputs: number; readonly unsettled: boolean; readonly turnStarts: number; readonly parked?: string }
  unavailable(name: string): void
}) {
  return createSessionHandoff({
    current: deps.owner.current,
    capture: deps.binding.capture,
    bindingCurrent: deps.binding.isCurrent,
    prepare: deps.binding.prepare,
    abandon: deps.binding.abandon,
    adopt: (candidate, capture, tail) => deps.binding.adopt(candidate, capture, (_previous, disposePrevious) => tail(disposePrevious)),
    read() {
      const runtime = deps.state()
      const session = runtime.sessions.ingress.read()
      return { cwd: session.cwd, working: session.working, pending: runtime.composer.ingress.read().pending }
    },
    commitWorkspace: (cwd, displayCwd) => deps.state().sessions.ingress.patch({ cwd, displayCwd }),
    notify: deps.notify,
    resetIdeSelection: deps.resetIdeSelection,
    clearStagedImages: deps.clearStagedImages,
    opener: deps.opener,
    activity: deps.activity,
    unavailable: deps.unavailable,
  })
}
