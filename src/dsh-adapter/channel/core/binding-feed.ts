import { publishRuntime } from '../../module-runtime.js'
import type { ModuleOwners } from '../../module-runtime.js'

import type { Context } from '@deepseek-ai/cordis'
import type { InputConvergence } from '../../../modules/composer/contracts.js'
import type { ChannelOwner } from '../../../shared/lifecycle/owner.js'
import type { AgentEvent, AgentEventMeta, AgentEventOf } from '../../../shared/protocol/events.js'
import { createChannelProjection, type ChannelProjection, type ChannelProjectionDeps } from '../../../modules/transcript/index.js'
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
 * The one session-batch writer path, shared by every channel composition:
 * binding-generation fence over the whole batch, session status and
 * pending-queue bookkeeping, compaction-progress gating, then the shared
 * projector and the renderer wake the backend asked for.
 */
export function createSessionBatchRouter(deps: {
  state: Pick<ModuleOwners, 'sessions' | 'settings' | 'composer' | 'transcript' | 'publication'>
  projector: ChannelProjection
  inputConvergence: InputConvergence
  /** Drop channel-side context attached to a discarded input (DSH pre-step
   *  attachments); absent where nothing is ever attached. */
  retireAttachment?(messageId: string): void
  /** The backend reset the conversation in place (`session.reset`, live):
   *  the events before it in the batch are projected first, those after it
   *  land on the cleared view. Absent = the event is projected (ignored). */
  onReset?(event: AgentEventOf<'session.reset'>): void
  warn(message: string): void
}) {
  const reconcileRetiredProjection = (status: 'idle' | 'disposed'): void => {
    if (!deps.state.sessions.ingress.read().working) return
    deps.warn(`dsh-tui: agent became ${status} while the channel still projected an open turn; releasing volatile UI gates`)
    deps.inputConvergence.cancelInFlight = false
    deps.state.composer.ingress.update(draft => { draft.cancelPending = false })
    deps.state.sessions.ingress.update(draft => { draft.working = false })
    deps.state.transcript.ingress.update(draft => { draft.activeToolCount = 0 })
    deps.projector.settleStreaming()
    deps.projector.updateSpinnerMode()
  }

  /** `session.status` as the backend reports it. */
  const applyStatus = (status: 'idle' | 'running' | 'requires-action' | 'disposed'): void => {
    if (status === 'disposed') {
      deps.state.sessions.ingress.update(draft => { draft.status = 'disposed' })
      reconcileRetiredProjection('disposed')
      publishRuntime(deps.state)
      return
    }
    // The channel's status is idle/running only; a parked prompt is mid-turn.
    deps.state.sessions.ingress.update(draft => { draft.status = status === 'idle' ? 'idle' : 'running' })
    if (status === 'idle') reconcileRetiredProjection('idle')
    publishRuntime(deps.state)
  }
  /**
   * The backend queue lost inputs. A claim and a discard both retire the
   * pending preview, but only a discard retires an attached-context entry. A
   * claim fires while the loop claims the batch, before the resident
   * `agent/pre-step` listener appends the attachment, so retiring there would
   * delete the context before it is ever injected.
   */
  const applyPending = (event: AgentEventOf<'pending.changed'>): void => {
    for (const messageId of event.discarded ?? []) deps.retireAttachment?.(messageId)
    // A discard of a docked preview only drops the backend copy. The dock
    // (where an interrupt parks inputs on the channel side) owns the row, so
    // it stays until sent (`deliverDocked`) or retracted. A claim always
    // retires the row: a fallback backend that kept its queue ran it.
    const dockedDiscards = new Set(event.discarded ?? [])
    for (const messageId of [...event.claimed ?? [], ...event.discarded ?? []]) {
      const before = deps.state.composer.ingress.read().pending.length
      deps.state.composer.ingress.update(draft => { draft.pending = draft.pending.filter(item =>
        item.id !== messageId || (item.docked === true && dockedDiscards.has(messageId))) })
      if (deps.state.composer.ingress.read().pending.length !== before) publishRuntime(deps.state)
    }
  }

  /** Monotonic count of live turns that started on a bound session (`/new`
   *  compares it across its open: a whole turn may come and go meanwhile). */
  let turnStarts = 0

  const route = (batch: readonly AgentEvent[], meta: AgentEventMeta, current: () => boolean): void => {
    // The generation fence covers the whole batch, whatever it carries. A
    // callback retained past a rebind (an in-flight dispatch, a compaction
    // summary stream that outlived the binding it started under) must never
    // write the replacement session's transcript.
    if (!current()) return
    let admitted: AgentEvent[] | undefined
    let progressOnly = batch.length > 0
    for (const [index, event] of batch.entries()) {
      switch (event.type) {
        case 'turn.start':
          if (!meta.replay) turnStarts += 1
          break
        case 'session.status':
          applyStatus(event.status)
          break
        case 'pending.changed':
          applyPending(event)
          break
        case 'compaction.progress':
          // Summary output only advances a compaction row that is open; a
          // stale stream after the row closed finds nothing to advance.
          if (deps.state.sessions.ingress.read().compaction === undefined) {
            admitted ??= batch.slice(0, index)
            continue
          }
          break
        default:
          break
      }
      if (event.type !== 'compaction.progress') progressOnly = false
      admitted?.push(event)
    }
    const events = admitted ?? batch
    if (progressOnly) {
      // Pure summary progress: frame-coalesced like the stream it counts.
      if (events.length === 0) return
      deps.projector.apply(events, meta)
      publishRuntime(deps.state, 'stream')
      return
    }
    // The one writer of the foreground transcript. A live conversation
    // reset splits the batch: what came before it is projected first.
    const onReset = meta.replay ? undefined : deps.onReset
    if (onReset !== undefined && events.some(event => event.type === 'session.reset')) {
      let start = 0
      events.forEach((event, index) => {
        if (event.type !== 'session.reset') return
        if (index > start) deps.projector.apply(events.slice(start, index), meta)
        onReset(event)
        start = index + 1
      })
      if (start < events.length) deps.projector.apply(events.slice(start), meta)
    } else {
      deps.projector.apply(events, meta)
    }
    if (meta.wake === 'frame') publishRuntime(deps.state, 'stream')
    else if (meta.wake !== 'none') publishRuntime(deps.state)
  }

  return {
    route(batch: readonly AgentEvent[], meta: AgentEventMeta, current: () => boolean): void {
      const progressOnly = batch.length > 0 && batch.every(event => event.type === 'compaction.progress')
      const mode = progressOnly || meta.wake === 'frame' ? 'stream'
        : meta.wake === 'none' ? 'silent' : 'immediate'
      deps.state.publication.batch(() => route(batch, meta, current), mode)
    },
    reconcileRetiredProjection,
    turnStarts: (): number => turnStarts,
  }
}

/**
 * The bind that follows the bound session: shared by the channel feed below
 * and the DSH binding-events owner (which direct regressions drive alone).
 */
export function createSessionBinder(deps: {
  owner: ChannelOwner
  binding: Pick<ChannelBinding, 'bind' | 'capture' | 'isCurrent' | 'subscribe'>
  state: Pick<ModuleOwners, 'sessions' | 'settings' | 'composer' | 'transcript' | 'publication'>
  inputConvergence: InputConvergence
  route(batch: readonly AgentEvent[], meta: AgentEventMeta, current: () => boolean): void
  hooks(): BindingFeedHooks

}) {
  const { owner, binding, state, inputConvergence } = deps
  /**
   * Links the bound session's prompts to the stores Chat renders. One link
   * per binding: a replaced session (or a released channel) withdraws
   * everything it parked, so no panel outlives its session.
   */
  /** Bind the current session: the one subscription feeding the projector. */
  const bind = (seed?: readonly AgentEvent[]): void => {
    const hooks = deps.hooks()
    try {
      deps.state.sessions.ingress.update(draft => { draft.agentBindingGeneration = binding.bind() })
      hooks.onGeneration?.()
      inputConvergence.cancelInFlight = false
      inputConvergence.interruptSeq += 1
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
  return { bind: (seed?: readonly AgentEvent[]) => state.publication.batch(() => bind(seed)) }
}

export function createBindingFeed(ctx: Context, deps: {
  owner: ChannelOwner
  binding: ChannelBinding
  state: Pick<ModuleOwners, 'sessions' | 'settings' | 'composer' | 'transcript' | 'publication'>
  inputConvergence: InputConvergence
  /** The projector's channel-side dependencies; `jobs` and `pricingWindow`
   *  stay writable until the channel starts (`configureProjection`). */
  projection: Omit<ChannelProjectionDeps, 'inputConvergence'>
  retireAttachment(messageId: string): void
  hooks(): BindingFeedHooks
  /** A live `session.reset` (see createSessionBatchRouter). */
  onReset?(event: AgentEventOf<'session.reset'>): void
}) {
  const { owner, binding, state, inputConvergence } = deps
  // The projector reads its deps per use, so an extension can install its
  // job feed and pricing policy before any event is projected.
  const projectorDeps: ChannelProjectionDeps = { ...deps.projection, inputConvergence }
  const projector = state.transcript.ingress.createProjection({ sessions: state.sessions, settings: state.settings, composer: state.composer }, projectorDeps)
  const router = createSessionBatchRouter({
    state,
    projector,
    inputConvergence,
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
    state,
    inputConvergence,
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
