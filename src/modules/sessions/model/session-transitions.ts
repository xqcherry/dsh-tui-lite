import { t } from '../../../shared/i18n.js'
import type { Notify } from '../../../shared/protocol/notifications.js'
import type { ResumeResult } from '../../../shared/protocol/session.js'

/** Resource tokens stay opaque: only the host may inspect agents or binding captures. */
export interface SessionReservation {
  settle(): void
  abandon(): void
}

type DisposePrevious = (next: 'dispose' | 'park') => void

interface AdoptionHost<Session, Capture> {
  capture(): Capture
  available(): boolean
  working(): boolean
  current(): boolean
  bindingCurrent(capture: Capture): boolean
  settleCompaction(): Promise<void>
  abandon(candidate: Session): Promise<void>
  adopt<Result>(candidate: Session, capture: Capture, tail: (disposePrevious: DisposePrevious) => Result): Result
  clearStagedImages(): void
  settleReplay(): void
  setReplayStatus(candidate: Session): void
  bindAgent(): void
  refreshCommands(): void
  refreshLoadedContext(): Promise<void>
  refreshSkillCommands(): Promise<void>
  publish(): void
  notify: Notify
}

export interface PersistedSessionResumeHost<Session, Capture, Entry, Plan> extends AdoptionHost<Session, Capture> {
  entry(): { readonly identity: Entry; readonly sessionId: string }
  sameEntry(entry: Entry): boolean
  waitForDisposal(sessionId: string): Promise<void>
  liveMounted(sessionId: string): boolean
  readonly localPid: number
  reserve(sessionId: string): Promise<{ readonly ok: true; readonly reservation: SessionReservation } | { readonly ok: false; readonly result: ResumeResult }>
  plan(sessionId: string): Promise<Plan>
  prepare(capture: Capture, sessionId: string, plan: Plan): Promise<Session>
  attach(candidate: Session, sessionId: string): Promise<void>
  commitWorkspace(candidate: Session): void
  resetIdeSelection(): void
  refreshGitBranch(): void
  reset(candidate: Session, plan: Plan): void
  replay(candidate: Session): void
  remember(sessionId: string): void
}

/** Resume policy retains its entry-session identity through every asynchronous phase. */
export function createPersistedSessionResume<Session, Capture, Entry, Plan>(host: PersistedSessionResumeHost<Session, Capture, Entry, Plan>) {
  const resume = async (sessionId: string, capture: Capture, entry: Entry, reservation: SessionReservation): Promise<ResumeResult> => {
    let committed = false
    try {
      await host.settleCompaction()
      if (!host.bindingCurrent(capture) || !host.sameEntry(entry)) return { ok: false, reason: 'cancelled' }
      if (host.liveMounted(sessionId) || host.working()) return { ok: false, reason: 'cancelled' }
      if (!host.available()) {
        host.notify(t('resume-unavailable'), { color: 'error' })
        return { ok: false, reason: 'unavailable' }
      }
      const plan = await host.plan(sessionId)
      let candidate: Session
      try { candidate = await host.prepare(capture, sessionId, plan) }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        host.notify(t('resume-failed', { err: message }), { color: 'error', timeoutMs: 8000 })
        return { ok: false, reason: 'failed', error: message }
      }
      if (!host.bindingCurrent(capture)) {
        await host.abandon(candidate)
        return { ok: false, reason: 'cancelled' }
      }
      try { await host.attach(candidate, sessionId) }
      catch (error) {
        host.notify(t('resume-attach-failed', { err: error instanceof Error ? error.message : String(error) }), { color: 'warning', timeoutMs: 8000 })
      }
      if (!host.current() || !host.sameEntry(entry)) {
        await host.abandon(candidate)
        host.notify(t('resume-session-changed'), { color: 'error' })
        return { ok: false, reason: 'failed', error: 'live session changed during resume' }
      }
      const result = host.adopt<ResumeResult>(candidate, capture, disposePrevious => {
        host.commitWorkspace(candidate)
        host.resetIdeSelection()
        host.refreshGitBranch()
        host.clearStagedImages()
        host.reset(candidate, plan)
        host.replay(candidate)
        host.settleReplay()
        host.setReplayStatus(candidate)
        host.bindAgent()
        host.refreshCommands()
        void host.refreshLoadedContext()
        void host.refreshSkillCommands()
        host.remember(sessionId)
        host.publish()
        disposePrevious('dispose')
        return { ok: true }
      })
      committed = true
      return result
    } finally {
      if (committed) reservation.settle()
      else reservation.abandon()
    }
  }

  return async (sessionId: string): Promise<ResumeResult> => {
    const capture = host.capture()
    if (!host.available()) {
      host.notify(t('resume-unavailable'), { color: 'error' })
      return { ok: false, reason: 'unavailable' }
    }
    const entry = host.entry()
    if (sessionId === entry.sessionId) return { ok: true }
    if (host.working()) {
      host.notify(t('resume-while-working'), { color: 'warning' })
      return { ok: false, reason: 'cancelled' }
    }
    await host.waitForDisposal(sessionId)
    if (!host.bindingCurrent(capture)) return { ok: false, reason: 'cancelled' }
    if (host.liveMounted(sessionId)) return { ok: false, reason: 'occupied', pid: host.localPid }
    const reserved = await host.reserve(sessionId)
    if (!reserved.ok) return reserved.result
    return resume(sessionId, capture, entry.identity, reserved.reservation)
  }
}

export interface ModelForkHost<Session, Capture, Seed, Resource, Preset> extends AdoptionHost<Session, Capture> {
  snapshot(): Seed
  reserve(): Promise<{ readonly resource: Resource; readonly reservation: SessionReservation }>
  preset(): Promise<Preset>
  prepare(capture: Capture, resource: Resource, seed: Seed, preset: Preset, route: { provider: string; model: string }): Promise<Session>
  attach(resource: Resource): Promise<void>
  reset(candidate: Session, preset: Preset, route: { provider: string; model: string }): void
  dropModelCompletion(): void
  replay(seed: Seed): void
  remember(resource: Resource): void
  writeModelPref(provider: string, model: string): boolean
}

/** Model forks preserve their own policy: no additional resume/new race probes. */
export function createModelFork<Session, Capture, Seed, Resource, Preset>(host: ModelForkHost<Session, Capture, Seed, Resource, Preset>) {
  return async (provider: string, model: string): Promise<boolean> => {
    const capture = host.capture()
    if (host.working()) { host.notify(t('model-switch-while-working'), { color: 'warning' }); return false }
    if (!host.available()) { host.notify(t('model-switch-unavailable'), { color: 'error' }); return false }
    let seed: Seed
    try {
      await host.settleCompaction()
      seed = host.snapshot()
    } catch (error) { host.notify(t('model-switch-fork-failed', { err: error instanceof Error ? error.message : String(error) }), { color: 'error' }); return false }
    const { resource, reservation } = await host.reserve()
    let committed = false
    let released = false
    const releaseReservation = (): void => {
      if (released) return
      released = true
      reservation.abandon()
    }
    try {
      const preset = await host.preset()
      const route = { provider, model }
      let candidate: Session
      try { candidate = await host.prepare(capture, resource, seed, preset, route) }
      catch (error) { releaseReservation(); host.notify(t('model-switch-failed', { err: error instanceof Error ? error.message : String(error) }), { color: 'error', timeoutMs: 8000 }); return false }
      try { await host.attach(resource) }
      catch (error) { host.notify(t('model-switch-attach-failed', { err: error instanceof Error ? error.message : String(error) }), { color: 'warning', timeoutMs: 8000 }) }
      if (!host.bindingCurrent(capture) || !host.current()) { await host.abandon(candidate); return false }
      const result = host.adopt<boolean>(candidate, capture, disposePrevious => {
        host.reset(candidate, preset, route)
        host.dropModelCompletion()
        host.replay(seed)
        host.settleReplay()
        host.setReplayStatus(candidate)
        host.clearStagedImages()
        host.bindAgent()
        host.refreshCommands()
        void host.refreshLoadedContext()
        void host.refreshSkillCommands()
        host.remember(resource)
        host.publish()
        disposePrevious('dispose')
        if (!host.writeModelPref(provider, model)) host.notify(t('model-pref-write-failed'), { color: 'warning' })
        return true
      })
      committed = true
      return result
    } finally {
      if (committed) reservation.settle()
      else releaseReservation()
    }
  }
}
