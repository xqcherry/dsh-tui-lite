import type { Context } from '@deepseek-ai/cordis'
import { ActivityStore, createActivityFeed } from '../modules/activity/index.js'
import type { ProjectionRegistryLike } from '../modules/activity/index.js'
export { ActivityStore, ACTIVITY_PROJECTION_KEY, asActivityView, createActivityFeed, seedActivity } from '../modules/activity/index.js'
export type { ActivityView, ActivityPhase, ProjectionRegistryLike } from '../modules/activity/index.js'

/** How often a live host projection is re-read. */
export const LIVE_TICK_MS = 500

/**
 * Wire one store to the host's projection registry.
 *
 * Registration is deferred through `inject` because the plugin that *publishes*
 * the unit is mounted alongside this one: the registry may not exist yet, and
 * the unit may not be registered until later still. Both absences are normal —
 * a composition without the activity plugin simply never fills the store, and
 * the line falls back to whatever else the UI has.
 *
 * The feed is event-driven, so a value only lands when a committed event folds;
 * its elapsed text would therefore freeze for the length of a long tool. The
 * host renders a value when it is READ, so a timer re-reads the live ones: the
 * seconds advance, the copy and language stay the plugin's, and a settled value
 * (idle, or a finished turn) stops the timer instead of being polled forever.
 * @param ctx - Host context of the composition root.
 * @param store - Store to fill.
 */
export function attachActivityProjection(ctx: Context, store: ActivityStore): void {
  ctx.inject(['sessionProjections'] as never, ((projectionCtx: Context) => {
    const registry = (projectionCtx as unknown as {
      sessionProjections?: ProjectionRegistryLike
    }).sessionProjections
    if (registry === undefined) return
    store.attachRegistry(registry)
    const offFeed = registry.onChanged(createActivityFeed(store))

    let timer: NodeJS.Timeout | undefined
    const stopTimer = (): void => {
      if (timer === undefined) return
      clearInterval(timer)
      timer = undefined
    }
    /** Arm while something is counting time, disarm the moment nothing is. */
    const reconcileTimer = (): void => {
      if (!store.hasLive()) {
        stopTimer()
        return
      }
      if (timer !== undefined) return
      timer = setInterval(() => {
        store.refreshLive()
      }, LIVE_TICK_MS)
      timer.unref()
    }
    const offStore = store.subscribe(reconcileTimer)
    reconcileTimer()

    // The cleanup belongs to the injected fiber, not the outer ctx: a service
    // re-provide re-runs the callback above, and registering on the outer ctx
    // would stack feed listeners (the old listener's disposer would only run
    // when the whole composition root goes down).
    projectionCtx.effect(() => () => {
      offStore()
      stopTimer()
      offFeed()
    }, 'dsh-tui activity projection feed')
  }) as never)
}

/**
 * Create the composition root's activity store and wire it to the host.
 * @param ctx - Host context of the composition root.
 * @param enabled - Whether the working line is shown at all (cordis.yml
 *   `activity`; a static, config-time switch — the runtime `/activity` command
 *   only changes the preset). With the line off, nothing attaches: no feed,
 *   no registry, and therefore no 500ms tick for a line nobody renders.
 * @returns the store the UI reads from.
 */
export function createActivityStore(ctx: Context, enabled: boolean): ActivityStore {
  const store = new ActivityStore(message => { ctx.logger.warn(message) })
  if (enabled) attachActivityProjection(ctx, store)
  return store
}
