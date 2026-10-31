/**
 * `/new` prepares and adopts a dsh session through the binding transaction.
 * The opener reserves its mount, creates the agent and attaches its workspace.
 * Activity and ownership are checked again after preparation so a concurrent
 * input or session switch cannot be displaced. Failed candidates are closed
 * before their reservations are released; dsh resume has its own adoption path.
 */
import type { Context } from '@deepseek-ai/cordis'
import { t } from '../../../shared/i18n.js'
import type { ChannelOwner } from '../../../shared/lifecycle/owner.js'
import type { DshSession as AgentSession } from '../../backend/session.js'
import type { ChannelBinding } from '../binding.js'
import type { ChannelState } from '../types.js'

/** A guarded workspace handoff (`/workspace`); never on `Client.newSession()`. */
export interface NewSessionTarget {
  readonly cwd: string
  readonly displayCwd?: string
}

/** One `/new` attempt as the backend opens it. */
export interface NewSessionPlan {
  /** Claim whatever the attempt must hold before the session exists (DSH:
   *  the cross-process mount ledger). Runs once, after planning. */
  reserve?(): Promise<void>
  /** Open the fresh session; runs inside the binding's `prepare`. */
  open(cwd: string): Promise<AgentSession>
  /** Ownership work between preparation and adoption (DSH: workspace
   *  attachment); may notify, must not throw. */
  attach?(candidate: AgentSession, current: () => boolean): Promise<void>
  /** The backend's half of the synchronous adoption tail: reset and bind
   *  the candidate. Returns the id the session-switched notice names. */
  adopt(candidate: AgentSession): string
  /** Exactly once on every exit after `reserve`: keep (commit) or release
   *  what the plan holds. */
  finish?(committed: boolean): void
}

/** How a backend opens a fresh session for `/new`. */
export interface NewSessionOpener {
  /**
   * What happens to an input still in the channel's FIFO when `/new` adopts
   * (a parked `tui/input` decision, an `@` or IDE read). `true`: it is
   * stale-dropped with a notice and never delivered (DSH, pinned by
   * verify-session-reset-hygiene scenario 8). Absent: the input belongs to
   * the session it was typed in, so `/new` is abandoned instead (a backend
   * handshake can take a minute).
   */
  readonly dropsParkedInputs?: boolean
  /** Synchronous gate before anything else (throws to refuse). */
  /** Whether a session can be opened at all; notifies when not. */
  available(): boolean
  /** Everything between the veto and the open. `undefined` stops quietly
   *  (the binding moved on); a throw becomes the `new-session-failed` notice. */
  plan(target: { readonly cwd: string }, current: () => boolean): Promise<NewSessionPlan | undefined>
}

export function createSessionSwitch(ctx: Context, deps: {
  owner: Pick<ChannelOwner, 'current'>
  binding: Pick<ChannelBinding, 'session' | 'capture' | 'isCurrent' | 'prepare' | 'abandon' | 'adopt'>
  state: () => Pick<ChannelState, 'agentId' | 'cwd' | 'displayCwd' | 'working' | 'pending'>
  notify: ChannelState['notify']
  /** What a parked decision's staleness is judged by: the same conversation
   *  across rebinds (default: the session object itself). */
  resetIdeSelection(): void
  clearStagedImages(): void
  opener(): NewSessionOpener | undefined
  /**
   * Monotonic activity of the bound session, compared across the open:
   * inputs dispatched (the input FIFO and `!!`), whether one is still on its
   * way, and live turns started.
   */
  activity(): { readonly inputs: number; readonly unsettled: boolean; readonly turnStarts: number; readonly parked?: string }
  unavailable(name: string): void
}) {
  const { binding, notify } = deps

  /**
   * An input still on its way to the bound session (a parked decision, an
   * `@` read, a `!!` command) would race any switch, so refuse at once and
   * name it, instead of after a handshake of up to a minute. Skipped for an
   * opener that stale-drops parked inputs (DSH).
   */
  const parkedInputRefused = (dropsParkedInputs: boolean): boolean => {
    if (dropsParkedInputs) return false
    const activity = deps.activity()
    if (!activity.unsettled) return false
    const parked = (activity.parked ?? '').replace(/\s+/gu, ' ').trim()
    notify(t('session-switch-input-parked', { input: parked.length > 40 ? `${parked.slice(0, 40)}…` : parked }), { color: 'warning', timeoutMs: 8000 })
    return true
  }

  const failed = (current: () => boolean, error: unknown): false => {
    if (current()) notify(t('new-session-failed', { err: error instanceof Error ? error.message : String(error) }), { color: 'error', timeoutMs: 8000 })
    return false
  }

  /**
   * For `/new` and `/resume`: the open may take long (a backend handshake),
   * and meanwhile the user may start work on the bound session: a turn (even
   * one that already finished, which `working` alone misses), a prompt
   * queued in the backend, or an input still in the channel's own FIFO (a
   * parked decision, an `@` or IDE-selection read, a `!!` command). Adopting
   * then would dispose that session and lose the work, so the caller
   * abandons its candidate. Inputs already queued when the switch began do
   * not count (a backend that holds queued inputs while idle keeps them).
   * With `dropsParkedInputs` the backend stale-drops FIFO inputs at adoption
   * instead (DSH), so they do not race it.
   */
  const raceProbe = (dropsParkedInputs: boolean): (() => boolean) => {
    const queuedAtStart = new Set(deps.state().pending.map(item => item.id))
    const activityAtStart = deps.activity()
    return () => {
      const live = deps.state()
      const activity = deps.activity()
      return live.working
        || live.pending.some(item => !queuedAtStart.has(item.id))
        || activity.turnStarts !== activityAtStart.turnStarts
        || (!dropsParkedInputs && (activity.inputs !== activityAtStart.inputs || activity.unsettled))
    }
  }

  /** `/new` (and the `/workspace` handoff): a fresh session of the bound backend. */
  const newSession = async (target?: NewSessionTarget): Promise<boolean> => {
    const opener = deps.opener()
    if (opener === undefined) {
      deps.unavailable('new')
      return false
    }
    const adoption = binding.capture()
    const state = deps.state()
    const targetCwd = target?.cwd ?? state.cwd
    const targetDisplayCwd = target?.displayCwd
    const current = (): boolean => deps.owner.current() && binding.isCurrent(adoption)
    if (state.working) {
      notify(t('new-session-while-working'), { color: 'warning' })
      return false
    }
    if (!opener.available()) return false
    if (parkedInputRefused(opener.dropsParkedInputs === true)) return false
    const raced = raceProbe(opener.dropsParkedInputs === true)
    const abandonRaced = async (candidate: AgentSession): Promise<false> => {
      await binding.abandon(candidate)
      if (current()) notify(t('new-session-raced'), { color: 'warning', timeoutMs: 8000 })
      return false
    }
    let plan: NewSessionPlan
    try {
      if (!current()) return false
      const planned = await opener.plan({ cwd: targetCwd }, current)
      if (planned === undefined) return false
      plan = planned
    } catch (error) {
      return failed(current, error)
    }
    await plan.reserve?.()
    // Do not catch the synchronous commit tail. A post-commit setup failure
    // is owned by binding.adopt(), which revokes the new live session and
    // must reject its caller rather than masquerade as an ordinary false.
    let committed = false
    try {
      let candidate: AgentSession
      try {
        candidate = await binding.prepare(adoption, () => plan.open(targetCwd))
      } catch (error) {
        return failed(current, error)
      }
      if (!current()) { await binding.abandon(candidate); return false }
      // Checked before the attach too: an abandoned candidate must not have
      // been accounted to a workspace first (DSH ownership is durable).
      if (raced()) return await abandonRaced(candidate)
      if (plan.attach !== undefined) {
        await plan.attach(candidate, current)
        if (!current()) { await binding.abandon(candidate); return false }
      }
      if (raced()) return await abandonRaced(candidate)
      const result = binding.adopt(candidate, adoption, (previous, disposePrevious) => {
        const previousSessionId = previous.session.sessionId
        const tail = deps.state()
        // The target only becomes shared channel state inside the successful
        // adoption tail. A losing prepared session therefore cannot publish
        // or roll back another workspace's cwd.
        tail.cwd = targetCwd
        tail.displayCwd = targetDisplayCwd ?? targetCwd
        deps.resetIdeSelection()
        // clearStagedImages() also resets the input FIFO and the
        // pending-decision indicators. It must run before the adoption's
        // first emit: a submit enqueued from a session-changed subscriber has
        // to land on a fresh chain, not behind the replaced session's parked
        // promise.
        deps.clearStagedImages()
        const sessionId = plan.adopt(candidate)
        disposePrevious('dispose')
        return true
      })
      committed = true
      return result
    } finally {
      plan.finish?.(committed)
    }
  }

  /**
   * `/resume` (and the adoption of a rewind's fork, `kind: 'rewind'`): a
   * persisted session of the bound backend replaces the bound one. The bound
   * session is closed by the adoption; a running turn refuses the switch.
   */
  return { newSession }
}
