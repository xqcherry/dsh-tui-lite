/** Internal command composition follows the same production UI dispatcher.
 * A bare createChannel embedder intentionally keeps its direct local API.
 */
import type { Client } from '../../app/state/ui-policy.js'
import type { ChannelState } from './types.js'

const dispatchers = new WeakMap<ChannelState, Client>()

export function bindChannelCommands(state: ChannelState, commands: Client): void {
  dispatchers.set(state, commands)
  // Keep the revoked dispatcher installed: late async work must fail closed,
  // not revert to the bare-embedder path after production teardown.
}

export function channelCommands(state: ChannelState): Client | ChannelState {
  return dispatchers.get(state) ?? state
}
