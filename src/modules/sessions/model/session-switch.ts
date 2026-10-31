import { t } from '../../../shared/i18n.js'
import type { Notify } from '../../../shared/protocol/notifications.js'

/** A guarded workspace handoff (`/workspace`); never on the public new-session command. */
export interface NewSessionTarget {
  readonly cwd: string
  readonly displayCwd?: string
}

/** One `/new` attempt as the backend opens it. */
export interface NewSessionPlan<Session> {
  /** Claim whatever the attempt must hold before the session exists (DSH:
   *  the cross-process mount ledger). Runs once, after planning. */
  reserve?(): Promise<void>
  /** Open the fresh session; runs inside the binding's `prepare`. */
  open(cwd: string): Promise<Session>
  /** Ownership work between preparation and adoption (DSH: workspace
   *  attachment); may notify, must not throw. */
  attach?(candidate: Session, current: () => boolean): Promise<void>
  /** The backend's half of the synchronous adoption tail: reset and bind
   *  the candidate. Returns the id the session-switched notice names. */
  adopt(candidate: Session): string
  /** Exactly once on every exit after `reserve`: keep (commit) or release
   *  what the plan holds. */
  finish?(committed: boolean): void
}

/** How a backend opens a fresh session for `/new`. */
export interface NewSessionOpener<Session> {
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
  plan(target: { readonly cwd: string }, current: () => boolean): Promise<NewSessionPlan<Session> | undefined>
}

export interface SessionHandoffHost<Session, Capture> {
  current(): boolean
  capture(): Capture
  bindingCurrent(capture: Capture): boolean
  prepare(capture: Capture, create: () => Promise<Session>): Promise<Session>
  abandon(candidate: Session): Promise<void>
  adopt<Result>(candidate: Session, capture: Capture, tail: (disposePrevious: (next: 'dispose' | 'park') => void) => Result): Result
  read(): { readonly cwd: string; readonly working: boolean; readonly pending: readonly { readonly id: string }[] }
  commitWorkspace(cwd: string, displayCwd: string): void
  notify: Notify
  resetIdeSelection(): void
  clearStagedImages(): void
  opener(): NewSessionOpener<Session> | undefined
  activity(): { readonly inputs: number; readonly unsettled: boolean; readonly turnStarts: number; readonly parked?: string }
  unavailable(name: string): void
}

/** Client-side preparation/race policy; resource authority remains in the host. */
export function createSessionHandoff<Session, Capture>(deps: SessionHandoffHost<Session, Capture>) {
  const { notify } = deps

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
    const queuedAtStart = new Set(deps.read().pending.map(item => item.id))
    const activityAtStart = deps.activity()
    return () => {
      const live = deps.read()
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
    const adoption = deps.capture()
    const state = deps.read()
    const targetCwd = target?.cwd ?? state.cwd
    const targetDisplayCwd = target?.displayCwd
    const current = (): boolean => deps.current() && deps.bindingCurrent(adoption)
    if (state.working) {
      notify(t('new-session-while-working'), { color: 'warning' })
      return false
    }
    if (!opener.available()) return false
    if (parkedInputRefused(opener.dropsParkedInputs === true)) return false
    const raced = raceProbe(opener.dropsParkedInputs === true)
    const abandonRaced = async (candidate: Session): Promise<false> => {
      await deps.abandon(candidate)
      if (current()) notify(t('new-session-raced'), { color: 'warning', timeoutMs: 8000 })
      return false
    }
    let plan: NewSessionPlan<Session>
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
      let candidate: Session
      try {
        candidate = await deps.prepare(adoption, () => plan.open(targetCwd))
      } catch (error) {
        return failed(current, error)
      }
      if (!current()) { await deps.abandon(candidate); return false }
      // Checked before the attach too: an abandoned candidate must not have
      // been accounted to a workspace first (DSH ownership is durable).
      if (raced()) return await abandonRaced(candidate)
      if (plan.attach !== undefined) {
        await plan.attach(candidate, current)
        if (!current()) { await deps.abandon(candidate); return false }
      }
      if (raced()) return await abandonRaced(candidate)
      const result = deps.adopt(candidate, adoption, disposePrevious => {
        // The target only becomes shared channel state inside the successful
        // adoption tail. A losing prepared session therefore cannot publish
        // or roll back another workspace's cwd.
        deps.commitWorkspace(targetCwd, targetDisplayCwd ?? targetCwd)
        deps.resetIdeSelection()
        // clearStagedImages() also resets the input FIFO and the
        // pending-decision indicators. It must run before the adoption's
        // first emit: a submit enqueued from a session-changed subscriber has
        // to land on a fresh chain, not behind the replaced session's parked
        // promise.
        deps.clearStagedImages()
        plan.adopt(candidate)
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
