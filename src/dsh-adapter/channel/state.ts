import type { SessionModeSpec } from '../../modules/sessions/contracts.js'
import type { ModuleLaunch } from '../../shared/protocol/module-launch.js'
import type { ContextPressureSource } from '../context-occupancy.js'

/** Launch configuration belongs to channel construction, not the composition root. */
type LaunchOptions = ModuleLaunch['options']
export interface ChannelLaunchOptions extends LaunchOptions {
  /** Read the activity projection's current value when a session binds. A
   *  projection value only arrives on change, so a resumed session needs this
   *  read to render its line before the next event lands. */
  seedActivity?: (session: unknown) => void
  /**
   * Official context-occupancy source (see `dsh-adapter/context-occupancy.ts`).
   *
   * `read` is a cached map lookup — never a projection fold — so the channel's
   * `contextOccupancy` accessor may call it per read; `subscribe` is the
   * projection's own change feed, which republishes occupancy when it moves
   * between session events (a compaction rewriting the surface, the prompt
   * growing). Absent → the channel falls back to the last request's billed
   * sample, which is what a composition without the token meter must do.
   */
  contextPressure?: ContextPressureSource
  /** Read that source's current value when a session binds (see
   *  {@link ChannelLaunchOptions.contextPressure}). */
  seedContextOccupancy?: (session: unknown) => void
  modes?: readonly SessionModeSpec[]

}
