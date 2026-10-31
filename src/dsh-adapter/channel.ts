/** Compose one dsh session with its client state and host services. */
import type { Context } from '@deepseek-ai/cordis'
import { createChannelOwner } from '../app/lifecycle/owner.js'
import type { DshSession as AgentSession } from './backend/session.js'
import { createCoreChannel } from './channel/core/compose.js'
import { configureDshServices } from './channel/services.js'
import type { ChannelLaunchOptions } from './channel/state.js'
import type { ChannelState } from './channel/types.js'

/**
 * Create the live channel state for one agent session: replay the durable
 * transcript, subscribe to the session's events, and expose every TUI action.
 * @internal
 * @param ctx - The plugin context; optional services are resolved via ctx.get.
 * @param session - The concrete DSH session initially attached to this client.
 * @param options - Boot options: model route, cwd, provider, and the
 *   reasoning-effort / working-activity preferences.
 * @returns The live channel state, subscribed and ready to render.
 */
export function createChannel(
  ctx: Context,
  session: AgentSession,
  options: ChannelLaunchOptions,
): ChannelState {
  const owner = createChannelOwner()
  try {
    const core = createCoreChannel(ctx, session, options, owner)
    configureDshServices(core, ctx, session.dsh, options)
    return core.start()
  } catch (error) {
    // Setup is one transaction from the first acquired resource. Preserve the
    // construction failure while still attempting every registered rollback.
    try { owner.dispose() } catch { /* primary setup error remains authoritative */ }
    throw error
  }
}
