import type { Context } from '@deepseek-ai/cordis'
import type { Publication } from '../../../shared/state/module-store.js'
import type { ChannelProjection } from '../../../modules/transcript/contracts.js'
import type { ChannelOwner } from '../../../shared/lifecycle/owner.js'
import type { AgentEvent, AgentEventMeta, AgentEventOf } from '../../../shared/protocol/events.js'
import type { ChannelProjectionDeps } from '../../../modules/transcript/index.js'
import { createSessionBatchRouter } from '../../../modules/workbench/index.js'
import type { BindingCapture, ChannelBinding } from '../binding.js'

/** What one bind hands an extension's per-binding listeners. */
export interface BindingScope {
  readonly capture: BindingCapture
  /** Owner live and the binding still the captured one (ABA-safe). */
  current(): boolean
  /** Own a listener for this binding period (released on the next adoption). */
  register<T extends () => void>(dispose: T): T
}

/** Extension points of the feed (all optional; see the module comment). */
export interface BindingFeedHooks {
  /** Right after the generation advances (DSH: owner-level child listeners). */
  onGeneration?(): void
  /** After input convergence resets, before the session subscription. */
  onBind?(scope: BindingScope): void
  /** After the bind returned (outside its rollback). */
  afterBind?(): void
  /** The extension maintains the session-level facts and replays its seed
   *  synchronously: no history repaint, no capability observer. */
  /** Forget the bound session's translator state with the projector's. */
  resetTranslation?(): void
}

/**
 * The bind that follows the bound session: shared by the channel feed below
 * and the DSH binding-events owner (which direct regressions drive alone).
 */
export function createSessionBinder(deps: {
  owner: ChannelOwner
  binding: Pick<ChannelBinding, 'bind' | 'capture' | 'isCurrent' | 'subscribe'>
  batch: Publication['batch']
  setBindingGeneration(generation: number): void
  resetInputConvergence(): void
  route(batch: readonly AgentEvent[], meta: AgentEventMeta, current: () => boolean): void
  hooks(): BindingFeedHooks

}) {
  const { owner, binding } = deps
  /**
   * Links the bound session's prompts to the stores Chat renders. One link
   * per binding: a replaced session (or a released channel) withdraws
   * everything it parked, so no panel outlives its session.
   */
  /** Bind the current session: the one subscription feeding the projector. */
  const bind = (seed?: readonly AgentEvent[]): void => {
    const hooks = deps.hooks()
    try {
      deps.setBindingGeneration(binding.bind())
      hooks.onGeneration?.()
      deps.resetInputConvergence()
      const capture = binding.capture()
      const session = capture.session
      const current = (): boolean => owner.current() && binding.isCurrent(capture)
      const register = <T extends () => void>(dispose: T): T => {
        binding.subscribe(dispose)
        return dispose
      }
      hooks.onBind?.({ capture, current, register })
      register(session.subscribe((batch, meta) => deps.route(batch, meta, current)))
    } catch (error) {
      owner.dispose()
      throw error
    }
    hooks.afterBind?.()
  }
  return { bind: (seed?: readonly AgentEvent[]) => deps.batch(() => bind(seed)) }
}

export function createBindingFeed(ctx: Context, deps: {
  owner: ChannelOwner
  binding: ChannelBinding
  batch: Publication['batch']
  setBindingGeneration(generation: number): void
  resetInputConvergence(): void
  createProjection(deps: ChannelProjectionDeps): ChannelProjection
  routing: Pick<Parameters<typeof createSessionBatchRouter>[0], 'sessions' | 'composer' | 'transcript' | 'publication' | 'publish'>
  /** The projector's channel-side dependencies; `jobs` and `pricingWindow`
   *  stay writable until the channel starts (`configureProjection`). */
  projection: ChannelProjectionDeps
  retireAttachment(messageId: string): void
  hooks(): BindingFeedHooks
  /** A live `session.reset` (see createSessionBatchRouter). */
  onReset?(event: AgentEventOf<'session.reset'>): void
}) {
  const { owner, binding } = deps
  // The projector reads its deps per use, so an extension can install its
  // job feed and pricing policy before any event is projected.
  const projectorDeps: ChannelProjectionDeps = { ...deps.projection }
  const projector = deps.createProjection(projectorDeps)
  const router = createSessionBatchRouter({
    ...deps.routing,
    projector,
    retireAttachment: deps.retireAttachment,
    ...(deps.onReset === undefined ? {} : { onReset: deps.onReset }),
    warn: message => ctx.logger.warn(message),
  })

  /** Forget every per-session projection ledger: the projector's and the
   *  bound session translator's, together. */
  const resetProjection = (): void => {
    projector.reset()
    deps.hooks().resetTranslation?.()
  }

  const binder = createSessionBinder({
    owner,
    binding,
    batch: deps.batch,
    setBindingGeneration: deps.setBindingGeneration,
    resetInputConvergence: deps.resetInputConvergence,
    route: router.route,
    hooks: deps.hooks,

  })

  return {
    projector,
    router,
    bind: binder.bind,
    resetProjection,
    /** Install the backend's job-registry feed and pricing policy (before start). */
    configureProjection(update: Partial<Pick<ChannelProjectionDeps, 'jobs' | 'pricingWindow'>>): void {
      if (update.jobs !== undefined) projectorDeps.jobs = update.jobs
      if (update.pricingWindow !== undefined) projectorDeps.pricingWindow = update.pricingWindow
    },
  }
}

export type BindingFeed = ReturnType<typeof createBindingFeed>
