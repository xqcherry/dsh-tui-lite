import type { SessionsSnapshot } from '../../modules/sessions/contracts.js'
import type { SessionAdoptionFacts } from '../../modules/workbench/contracts.js'
import type { Notify } from '../../shared/protocol/notifications.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import { t } from '../../shared/i18n.js'
import type { ChannelOwner } from '../../shared/lifecycle/owner.js'
import { readModelPref } from '../../modules/settings/index.js'
import { migratePresetPref, readPresetPref } from '../../modules/settings/index.js'
import { createNewSessionPlanner, createPersistedSessionResume, mountFailureText } from '../../modules/sessions/index.js'
import { clearResumeTarget, touchSession, writeResumeTarget } from '../../modules/sessions/index.js'
import {
  occupancyOf,
  readSessionOwners,
  reserveMount,
  reserveNewSession,
  type MountReservation,
} from '../../modules/sessions/index.js'
import { explicitModelRoute, recordedModelRoute, validateModelRoute } from '../../modules/settings/index.js'
import type { DshSession as AgentSession } from '../backend/session.js'
import { createDshSession, dshHandleOf } from '../backend/session.js'
import { ensureLegacySessionEventTypes } from '../compat/index.js'
import { snapshotLiveSessionEvents } from '../compat/liveSession.js'
import { composePreset, resolvePersistedPreset, resolvePersistedRoute } from '../presets.js'
import { attachSessionToWorkspace } from '../workspace.js'
import type { ChannelBinding } from './binding.js'
import type { NewSessionOpener } from './core/session-switch.js'
import type { ResumeResult } from './types.js'

type Binding = ChannelBinding
interface AdoptionPorts {
  session(): Readonly<Pick<SessionsSnapshot, 'cwd' | 'working'>>
  adoptWorkspace(cwd: string): void
  setWorking(working: boolean): void
  resetSession(facts: SessionAdoptionFacts): void
  publish(): void
}

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
  ports: AdoptionPorts,
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
    notify: Notify
  },
) {
  const resetCandidate = (
    candidate: AgentSession,
    agentPreset: string | undefined,
    route: { provider: string; model: string } | undefined,
  ): void => {
    const { agent } = dshHandleOf(candidate)
    ports.resetSession({
      identity: { status: agent.status, agentId: agent.id, sessionId: agent.session.id, agentPreset },
      route,
      clearLoadedContext: true,
    })
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

  const resumeTo = (sessionId: string): Promise<ResumeResult> => {
    // Each attempt retains the service looked up at its own original phases.
    let agents: ResumeAgents | undefined
    return createPersistedSessionResume({
      capture: deps.binding.capture,
      available: () => { agents = ctx.get('agents') as ResumeAgents | undefined; return agents !== undefined },
      entry: () => ({ identity: deps.binding.agent.session, sessionId: String(deps.binding.agent.session.id) }),
      sameEntry: entry => deps.binding.agent.session === entry,
      working: () => ports.session().working,
      current: deps.owner.current,
      bindingCurrent: deps.binding.isCurrent,
      waitForDisposal: deps.binding.waitForDisposal,
      liveMounted: id => agents?.get?.(SessionId(id)) !== undefined,
      localPid: process.pid,
      reserve: reserveDiskResume,
      settleCompaction: deps.settleCompaction,
      async plan(id) {
        ensureLegacySessionEventTypes()
        const composed = await composePreset(ctx, await resolvePersistedPreset(ctx, SessionId(id)))
        const explicitRoute = explicitModelRoute({ provider: options.configuredProvider, model: options.configuredModel })
        const persistedRoute = await resolvePersistedRoute(ctx, SessionId(id))
        return { composed, explicitRoute, persistedRoute }
      },
      prepare: (capture, id, plan) => deps.binding.prepare(capture, async () => createDshSession(ctx, await agents!.resume({
        resumeSessionId: SessionId(id),
        agentOptions: {
          provider: plan.explicitRoute?.provider ?? plan.persistedRoute?.provider,
          model: plan.explicitRoute?.model ?? plan.persistedRoute?.model,
        },
        ...(plan.composed.setup === undefined ? {} : { setup: plan.composed.setup }),
      }))),
      async attach(candidate, id) { await attachSessionToWorkspace(ctx, dshHandleOf(candidate).agent.session.header.cwd ?? ports.session().cwd, SessionId(id)) },
      abandon: deps.binding.abandon,
      adopt: (candidate, capture, tail) => deps.binding.adopt(candidate, capture, (_previous, disposePrevious) => tail(disposePrevious)),
      commitWorkspace(candidate) {
        const cwd = dshHandleOf(candidate).agent.session.header.cwd ?? ports.session().cwd
        ports.adoptWorkspace(cwd)
      },
      resetIdeSelection: deps.resetIdeSelection,
      refreshGitBranch: deps.refreshGitBranch,
      clearStagedImages: deps.clearStagedImages,
      reset: (candidate, plan) => resetCandidate(candidate, plan.composed.agentPreset, plan.explicitRoute ?? recordedModelRoute(snapshotLiveSessionEvents(dshHandleOf(candidate).agent.session))),
      replay: candidate => deps.replay(snapshotLiveSessionEvents(dshHandleOf(candidate).agent.session)),
      settleReplay: deps.settleReplay,
      setReplayStatus: candidate => ports.setWorking(dshHandleOf(candidate).agent.status === 'running'),
      bindAgent: deps.bindAgent,
      refreshCommands: deps.refreshCommands,
      refreshLoadedContext: deps.refreshLoadedContext,
      refreshSkillCommands: deps.refreshSkillCommands,
      remember(id) { writeResumeTarget(id); touchSession(id) },
      publish: () => ports.publish(),
      notify: deps.notify,
    })(sessionId)
  }

  const newSessionOpener: NewSessionOpener = createNewSessionPlanner({
    options,
    available: () => ctx.get('agents') !== undefined,
    begin: () => ctx.get('agents') as { create(options: CreateAgentOptions): Promise<AgentHandle> } | undefined,
    settleCompaction: deps.settleCompaction,
    allocate: () => SessionId(randomUUID()),
    readPresetPref,
    async composePreset(preset) {
      const composed = await composePreset(ctx, preset)
      return { resource: composed, agentPreset: composed.agentPreset }
    },
    readModelPref,
    validateRoute(route, fallback) {
      const llm = ctx.get('llm') as { listModels(provider: string): Promise<readonly { id: string }[]> } | undefined
      return validateModelRoute(llm, route, fallback)
    },
    migratePresetPref,
    reserve: reserveCreatedSession,
    open: async (agents, sessionId, composed, route, cwd) => createDshSession(ctx, await agents.create({
      sessionId: SessionId(sessionId),
      meta: { cwd, ...(composed.agentPreset === undefined ? {} : { agentPreset: composed.agentPreset }) },
      agentOptions: route,
      ...(composed.setup === undefined ? {} : { setup: composed.setup }),
    })),
    async attach(sessionId, cwd) { await attachSessionToWorkspace(ctx, cwd, SessionId(sessionId)) },
    reset: resetCandidate,
    bindAgent: deps.bindAgent,
    refreshCommands: deps.refreshCommands,
    refreshLoadedContext: deps.refreshLoadedContext,
    refreshSkillCommands: deps.refreshSkillCommands,
    remember(candidate) {
      const { agent } = dshHandleOf(candidate)
      clearResumeTarget()
      touchSession(agent.id)
      return String(agent.id)
    },
    notify: deps.notify,
  })

  return { resumeTo, newSessionOpener }
}
