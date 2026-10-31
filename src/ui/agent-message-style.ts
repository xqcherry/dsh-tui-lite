import type { Theme } from './theme.js'
import type { AgentMessageState } from '../shared/protocol/agent-team.js'
import { t } from '../shared/i18n.js'

/** Delivery-state badge color: only what the channel reported — green is
 *  reserved for an explicit `delivered` fact, dim for `unknown`/`expired`. */
export function agentMessageStateColor(state: AgentMessageState): keyof Theme {
  if (state === 'delivered') return 'success'
  if (state === 'refused') return 'error'
  if (state === 'issued' || state === 'queued' || state === 'held') return 'warning'
  return 'subtle'
}

/** The localized state word (issued/queued/delivered/held/refused/expired/
 *  unknown) — one vocabulary across composer status lines and flow rows. */
export function agentMessageStateText(state: AgentMessageState): string {
  return t(`agent-message-delivery-${state}`)
}
