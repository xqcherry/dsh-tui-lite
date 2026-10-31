import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import { t } from '../../app/i18n.js'
import type { ChannelOwner } from '../../app/lifecycle/owner.js'
import { readModelPref } from '../../app/preferences/modelPrefs.js'
import { migratePresetPref, readPresetPref } from '../../app/preferences/presetPrefs.js'
import { mountFailureText } from '../../app/session/resumeFailure.js'
import { clearResumeTarget, touchSession, writeResumeTarget } from '../../app/session/sessionHistory.js'
import {
  occupancyOf,
  readSessionOwners,
  reserveMount,
  reserveNewSession,
  type MountReservation,
} from '../../app/session/sessionMounts.js'
import { explicitModelRoute, recordedModelRoute, resolveModelRoute, validateModelRoute } from '../../app/settings/modelRoute.js'
import { resetSessionProjection } from '../../app/state/session-reset.js'
import type { DshSession as AgentSession } from '../backend/session.js'
import { createDshSession, dshHandleOf } from '../backend/session.js'
import { ensureLegacySessionEventTypes } from '../compat/index.js'
import { snapshotLiveSessionEvents } from '../compat/liveSession.js'
import { composePreset, resolvePersistedPreset, resolvePersistedRoute } from '../presets.js'
import { attachSessionToWorkspace } from '../workspace.js'
import type { ChannelBinding } from './binding.js'
import type { NewSessionOpener, NewSessionPlan } from './core/session-switch.js'
import type { ChannelState, ResumeResult } from './types.js'

type Binding = ChannelBinding
type ResumeState = Pick<
  ChannelState,
  | 'working'
  | 'status'
  | 'agentId'
  | 'sessionId'
  | 'cwd'
  | 'displayCwd'
  | 'agentPreset'
  | 'provider'
  | 'model'
  | 'loadedContext'
  | 'contextWindow'
  | 'effortLevels'
  | 'reasoningEffort'
  | 'working'
  | 'emit'
> & Parameters<typeof resetSessionProjection>[0]

export type { NewSessionTarget } from './core/session-switch.js'

type ResumeAgents = {
  resume(options: {
    resumeSessionId: SessionId
    agentOptions?: { provider?: string; model?: string }
    setup?: CreateAgentOptions['setup']
  }): Promise<AgentHandle>
  /**
   * The live agent for a session id, when this process already hosts one.
   * Optional: a composition without the roster still resumes from disk, it
   * just cannot tell "already mounted here" from "on disk" up front.
   */
  get?(id: SessionId): Agent | undefined
}

/** Persisted-session and fresh-session foreground actions. */
export function createSessionResumeActions(
  ctx: Context,
  state: ResumeState,
  options: {
    configuredPreset?: string
    configuredProvider?: string
    configuredModel?: string
    provider: string
    model: string
  },
  deps: {
    owner: Pick<ChannelOwner, 'current'>
    binding: Pick<Binding, 'agent' | 'capture' | 'isCurrent' | 'prepare' | 'abandon' | 'adopt' | 'waitForDisposal'>
    rowIds: { value: number }
    resetProjector(): void
    resetSubagents(): void
    resetJobs(): void
    replay(events: readonly SessionEvent[]): void
    settleReplay(): void
    refreshGitBranch(): void
    bindAgent(): void
    refreshCommands(): void
    refreshLoadedContext(): Promise<void>
    refreshSkillCommands(): Promise<void>
    clearStagedImages(): void
    /** Drop the live IDE selection: the adopted session's cwd differs from
     *  the one the selection was made in. */
    resetIdeSelection(): void
    settleCompaction(): Promise<void>
    notify: ChannelState['notify']
  },
) {
  const resetAndBind = (
    handle: AgentHandle,
    agentPreset: string | undefined,
    route: { provider: string; model: string } | undefined,
    replay: boolean,
  ): void => {
    resetSessionProjection(state, deps.rowIds, deps.resetProjector, deps.resetSubagents, deps.resetJobs)
    state.status = handle.agent.status
    state.agentId = handle.agent.id
    state.sessionId = handle.agent.session.id
    state.agentPreset = agentPreset
    if (route !== undefined) {
      state.provider = route.provider
      state.model = route.model
    }
    state.loadedContext = undefined
    state.contextWindow = undefined
    state.effortLevels = undefined
    state.reasoningEffort = undefined
    if (replay) {
      deps.replay(snapshotLiveSessionEvents(handle.agent.session))
      deps.settleReplay()
      // A resumed log can end mid-turn; mirror boot's post-replay status.
      state.working = handle.agent.status === 'running'
    }
    deps.bindAgent()
    deps.refreshCommands()
    void deps.refreshLoadedContext()
    void deps.refreshSkillCommands()
  }

  /** Resume one durable session and release the replaced foreground handle. */
  const resume = async (
    sessionId: string,
    adoption: ReturnType<Binding['capture']>,
    entrySession?: Agent['session'],
    /**
     * The ledger reservation this call holds for `sessionId`; ended by this
     * function on every exit. `settle` on a commit (the agent is in the
     * registry from then on), `abandon` on every path that ends WITHOUT one —
     * including a throwing `binding.adopt()` and a setup failure inside its
     * tail, which revokes the candidate.
     */
    reservation?: MountReservation,
  ): Promise<ResumeResult> => {
    /**
     * The reservation is ended on EVERY exit from here, so the attempt owns it
     * for the whole body: `settle` on a commit (the agent is in the registry
     * from then on), `abandon` on everything else — a throwing
     * `binding.adopt()`, a setup failure inside its tail, and also a throw from
     * the preset/route reads below, which used to sit outside any guard and
     * would have left a pin that republishes the session as ours on every beat.
     */
    let committed = false
    try {
      return await runResume()
    } finally {
      if (committed) reservation?.settle()
      else reservation?.abandon()
    }

    async function runResume(): Promise<ResumeResult> {
      const agents = ctx.get('agents') as ResumeAgents | undefined
      if (!agents) {
        deps.notify(t('resume-unavailable'), { color: 'error' })
        return { ok: false, reason: 'unavailable' }
      }
      ensureLegacySessionEventTypes()
      const composed = await composePreset(ctx, await resolvePersistedPreset(ctx, SessionId(sessionId)))
      const explicitRoute = explicitModelRoute({ provider: options.configuredProvider, model: options.configuredModel })
      const persistedRoute = await resolvePersistedRoute(ctx, SessionId(sessionId))
      let candidate: AgentSession
      try {
        candidate = await deps.binding.prepare(adoption, async () => createDshSession(ctx, await agents.resume({
          resumeSessionId: SessionId(sessionId),
          agentOptions: {
            provider: explicitRoute?.provider ?? persistedRoute?.provider,
            model: explicitRoute?.model ?? persistedRoute?.model,
          },
          ...(composed.setup === undefined ? {} : { setup: composed.setup }),
        })))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        deps.notify(t('resume-failed', { err: message }), { color: 'error', timeoutMs: 8000 })
        return { ok: false, reason: 'failed', error: message }
      }
      const handle = dshHandleOf(candidate)
      if (!deps.binding.isCurrent(adoption)) {
        await deps.binding.abandon(candidate)
        return { ok: false, reason: 'cancelled' }
      }
      try {
        await attachSessionToWorkspace(ctx, handle.agent.session.header.cwd ?? state.cwd, SessionId(sessionId))
      } catch (error) {
        deps.notify(t('resume-attach-failed', { err: error instanceof Error ? error.message : String(error) }), { color: 'warning', timeoutMs: 8000 })
      }
      if (entrySession !== undefined && (!deps.owner.current() || deps.binding.agent.session !== entrySession)) {
        await deps.binding.abandon(candidate)
        deps.notify(t('resume-session-changed'), { color: 'error' })
        return { ok: false, reason: 'failed', error: 'live session changed during resume' }
      }
      // `adopt` is a transaction: it revokes the candidate and disposes it when
      // the tail fails, and it can also refuse before the tail ever runs. Only a
      // normal return is a commit, which is what the outer finally keys on.
      const result = deps.binding.adopt<ResumeResult>(candidate, adoption, (committedBinding, disposePrevious) => {
        const previousSessionId = String(committedBinding.agent.session.id)
        state.cwd = handle.agent.session.header.cwd ?? state.cwd
        state.displayCwd = state.cwd
        deps.resetIdeSelection()
        deps.refreshGitBranch()
        // Reset the input FIFO and pending-decision indicators BEFORE the first
        // emit (main's bind → clear → refresh order); see the /new tail.
        deps.clearStagedImages()
        resetAndBind(handle, composed.agentPreset, explicitRoute ?? recordedModelRoute(snapshotLiveSessionEvents(handle.agent.session)), true)
        writeResumeTarget(sessionId)
        touchSession(sessionId)
        state.emit()
        disposePrevious('dispose')
        return { ok: true }
      })
      committed = true
      return result
    }
  }

  /**
   * Reserve `sessionId` for a disk resume on THIS terminal.
   *
   * Returning a reservation means the caller owns the session in the ledger
   * until it calls `finish()`. That covers the whole attempt, not just the
   * `agents.resume` call: the awaits in between (veto, compaction, preset and
   * route reads) are exactly the window a publisher beat — or a peer — could
   * otherwise slip into.
   * @param sessionId - Session about to be resumed from disk.
   * @returns The reservation, or the refusal to hand back to the caller.
   */
  const reserveDiskResume = async (
    sessionId: string,
  ): Promise<{ readonly ok: true; readonly reservation: MountReservation } | { readonly ok: false; readonly result: ResumeResult }> => {
    // Cheap pre-filter for the friendly toast: the authoritative conflict test
    // runs inside reserveMount, under the ledger lock.
    const occupancy = occupancyOf(sessionId, readSessionOwners())
    if (occupancy.kind === 'occupied') {
      deps.notify(t('resume-session-occupied', { pid: occupancy.pid }), { color: 'error', timeoutMs: 8000 })
      return { ok: false, result: { ok: false, reason: 'occupied', pid: occupancy.pid } }
    }
    const reserved = await reserveMount(sessionId)
    if (!reserved.ok) {
      if (reserved.reason === 'occupied') {
        const pid = reserved.holders[0] ?? 0
        deps.notify(t('resume-session-occupied', { pid }), { color: 'error', timeoutMs: 8000 })
        return { ok: false, result: { ok: false, reason: 'occupied', pid } }
      }
      // Both of these are refusals, not conflicts, and neither may be dressed
      // up as "held by pid 0". The generic failure branch carries the sentence.
      return { ok: false, result: { ok: false, reason: 'failed', error: mountFailureText(reserved) } }
    }
    return { ok: true, reservation: reserved.reservation }
  }

  /**
   * Reserve a freshly minted session id for a create on THIS terminal. See
   * `reserveNewSession`: a new id cannot conflict, so a refusal is a loss of
   * announcement rather than a reason to stop, and it is warned about.
   * @param sessionId - Session id minted for the new agent.
   * @returns The reservation (a no-op when the claim could not be made).
   */
  const reserveCreatedSession = async (sessionId: string): Promise<MountReservation> => {
    const { reservation, failure } = await reserveNewSession(sessionId)
    if (failure !== undefined && failure.reason !== 'occupied') {
      deps.notify(mountFailureText(failure), { color: 'warning', timeoutMs: 8000 })
    }
    return reservation
  }

  const resumeTo = async (sessionId: string): Promise<ResumeResult> => {
    const adoption = deps.binding.capture()
    const agents = ctx.get('agents') as ResumeAgents | undefined
    if (!agents) {
      deps.notify(t('resume-unavailable'), { color: 'error' })
      return { ok: false, reason: 'unavailable' }
    }
    // The attached session as of entry, so a rival switch that commits while
    // the awaits below yield cannot be adopted over.
    const entrySession = deps.binding.agent.session
    if (String(sessionId) === String(entrySession.id)) return { ok: true }
    if (state.working) {
      deps.notify(t('resume-while-working'), { color: 'warning' })
      return { ok: false, reason: 'cancelled' }
    }
    // Switching away starts disposal without blocking the synchronous commit.
    // Do not adopt that closing Agent (or reopen its still-held JSONL writer).
    await deps.binding.waitForDisposal(sessionId)
    if (!deps.binding.isCurrent(adoption)) return { ok: false, reason: 'cancelled' }
    if (agents.get?.(SessionId(sessionId)) !== undefined) {
      return { ok: false, reason: 'occupied', pid: process.pid }
    }
    const reserved = await reserveDiskResume(sessionId)
    if (!reserved.ok) return reserved.result
    const reservation = reserved.reservation
    await deps.settleCompaction()
    if (!deps.binding.isCurrent(adoption) || deps.binding.agent.session !== entrySession) {
      reservation?.abandon()
      return { ok: false, reason: 'cancelled' }
    }
    if (agents.get?.(SessionId(sessionId)) !== undefined || state.working) {
      reservation.abandon()
      return { ok: false, reason: 'cancelled' }
    }
    return resume(sessionId, adoption, entrySession, reservation)
  }

  /**
   * How a DSH `/new` opens its fresh session: the capability shadow gate,
   * the agents service, compaction settled first, the preset and validated
   * model route, the cross-process mount reservation, `agents.create`,
   * workspace ownership, and the DSH half of the adoption tail. The
   * transaction itself (working check, veto, prepare/adopt, the re-check
   * after a slow open) lives in core/session-switch.ts.
   */
  const newSessionOpener: NewSessionOpener = {
    // An input still in the FIFO when /new adopts is stale-dropped (with a
    // notice), never delivered to either session; that is the DSH contract.
    dropsParkedInputs: true,
    // The typed workspace target seam still creates a real Agent/session; it
    // must pass the same shadow policy gate as the public /new action.
    available(): boolean {
      if (ctx.get('agents') !== undefined) return true
      deps.notify(t('new-session-unavailable'), { color: 'error' })
      return false
    },
    async plan(target, current): Promise<NewSessionPlan | undefined> {
      const agents = ctx.get('agents') as { create(options: CreateAgentOptions): Promise<AgentHandle> } | undefined
      if (agents === undefined) throw new Error(t('new-session-unavailable'))
      await deps.settleCompaction()
      if (!current()) return undefined
      const sessionId = SessionId(randomUUID())
      const presetPref = options.configuredPreset === undefined ? readPresetPref() : undefined
      const composed = await composePreset(ctx, options.configuredPreset ?? presetPref)
      if (!current()) return undefined
      const resolved = resolveModelRoute(
        { provider: options.configuredProvider, model: options.configuredModel },
        readModelPref(),
        { provider: options.provider, model: options.model },
      )
      const llm = ctx.get('llm') as { listModels(provider: string): Promise<readonly { id: string }[]> } | undefined
      const validated = await validateModelRoute(llm, resolved, { provider: options.provider, model: options.model })
      const route = validated.route
      if (!current()) return undefined
      if (!migratePresetPref(presetPref, composed.agentPreset)) {
        deps.notify(t('preset-switched-pref-failed', { id: composed.agentPreset ?? presetPref ?? 'unknown' }), { color: 'warning' })
      }
      if (validated.rejected !== undefined) {
        deps.notify(t('model-route-invalid', { provider: validated.rejected.provider, model: validated.rejected.model, fallback: `${route.provider}/${route.model}` }), { color: 'warning', timeoutMs: 8000 })
      }
      const targetCwd = target.cwd
      let reservation: MountReservation | undefined
      return {
        // Reserve before the factory runs: the moment `agents.create`
        // returns, this process holds the only write handle on a log no peer
        // has been told about yet, and the publisher would not name it until
        // its next beat.
        async reserve() { reservation = await reserveCreatedSession(sessionId) },
        open: async cwd => createDshSession(ctx, await agents.create({
          sessionId,
          meta: { cwd, ...(composed.agentPreset === undefined ? {} : { agentPreset: composed.agentPreset }) },
          agentOptions: route,
          ...(composed.setup === undefined ? {} : { setup: composed.setup }),
        })),
        async attach(_candidate, isCurrent) {
          try {
            await attachSessionToWorkspace(ctx, targetCwd, sessionId)
          } catch (error) {
            if (isCurrent()) deps.notify(t('new-session-attach-failed', { err: error instanceof Error ? error.message : String(error) }), { color: 'warning', timeoutMs: 8000 })
          }
        },
        adopt(candidate): string {
          const handle = dshHandleOf(candidate)
          resetAndBind(handle, composed.agentPreset, route, false)
          clearResumeTarget()
          touchSession(handle.agent.id)
          return String(handle.agent.id)
        },
        finish(committed) {
          if (committed) reservation?.settle()
          else reservation?.abandon()
        },
      }
    },
  }

  return { resumeTo, newSessionOpener }
}
