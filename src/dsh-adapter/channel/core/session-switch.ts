import type { PendingMessage } from '../../../shared/protocol/composer.js'
import type { Notify } from '../../../shared/protocol/notifications.js'
import type { Context } from '@deepseek-ai/cordis'
import { createSessionHandoff } from '../../../modules/sessions/index.js'
import type { NewSessionOpener as SessionOpener, NewSessionPlan as SessionPlan } from '../../../modules/sessions/contracts.js'
import type { DshSession } from '../../backend/session.js'
import type { ChannelBinding } from '../binding.js'

export type { NewSessionTarget } from '../../../modules/sessions/contracts.js'
export type NewSessionOpener = SessionOpener<DshSession>
export type NewSessionPlan = SessionPlan<DshSession>

/** DSH binding and resources implement the session module's narrow handoff host. */
export function createSessionSwitch(_ctx: Context, deps: {
  owner: { current(): boolean }
  binding: Pick<ChannelBinding, 'session' | 'capture' | 'isCurrent' | 'prepare' | 'abandon' | 'adopt'>
  read(): { readonly cwd: string; readonly working: boolean; readonly pending: readonly PendingMessage[] }
  commitWorkspace(cwd: string, displayCwd: string): void
  notify: Notify
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
    read: deps.read,
    commitWorkspace: deps.commitWorkspace,
    notify: deps.notify,
    resetIdeSelection: deps.resetIdeSelection,
    clearStagedImages: deps.clearStagedImages,
    opener: deps.opener,
    activity: deps.activity,
    unavailable: deps.unavailable,
  })
}
