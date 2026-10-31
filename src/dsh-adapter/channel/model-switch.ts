import { publishRuntime, type RuntimeCommands } from '../module-runtime.js'
import type { ModuleOwners } from '../module-runtime.js'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import { t } from '../../shared/i18n.js'
import type { ChannelOwner } from '../../shared/lifecycle/owner.js'
import { writeModelPref } from '../../modules/settings/index.js'
import { touchSession } from '../../modules/sessions/index.js'
import { reserveNewSession } from '../../modules/sessions/index.js'
import { resetSessionProjection } from '../../modules/sessions/index.js'
import type { DshSession as AgentSession } from '../backend/session.js'
import { createDshSession, dshHandleOf } from '../backend/session.js'
import { liveSessionCreateOptions, sliceLiveSessionSeed } from '../compat/index.js'
import { composePreset, runningPresetOf } from '../presets.js'
import { attachSessionToWorkspace } from '../workspace.js'
import type { ChannelBinding } from './binding.js'
import { childRecordsLineage } from './session-lineage.js'

type Binding = ChannelBinding
type SwitchState = Pick<ModuleOwners, 'sessions' | 'settings' | 'composer' | 'transcript' | 'activity' | 'publication'>

/** Model-route adoption transaction. It settles compaction before its fork snapshot and owns the post-commit reset. */
export function createModelSwitchAction(
  ctx: Context,
  state: SwitchState,
  deps: {
    owner: Pick<ChannelOwner, 'current'>
    binding: Pick<Binding, 'agent' | 'capture' | 'prepare' | 'isCurrent' | 'abandon' | 'adopt'>
    rowIds: { value: number }
    settleCompaction(): Promise<void>
    resetProjector(): void
    resetSubagents(): void
    resetJobs(): void
    replay(events: readonly SessionEvent[]): void
    settleReplay(): void
    bindAgent(): void
    refreshCommands(): void
    refreshLoadedContext(): Promise<void>
    refreshSkillCommands(): Promise<void>
    clearStagedImages(): void
    dropModelCompletion(): void
    notify: RuntimeCommands['notify']
  },
) {
  return async (provider: string, model: string): Promise<boolean> => {
    const adoption = deps.binding.capture()
    if (state.sessions.ingress.read().working) { deps.notify(t('model-switch-while-working'), { color: 'warning' }); return false }
    const agents = ctx.get('agents') as { create(options: CreateAgentOptions): Promise<AgentHandle> } | undefined
    if (agents === undefined) { deps.notify(t('model-switch-unavailable'), { color: 'error' }); return false }
    let seed: readonly SessionEvent[]
    try {
      // A compaction checkpoint may not settle after the model fork snapshot.
      await deps.settleCompaction()
      // No boundary = the whole source log (continue the conversation). Slice
      // the SOURCE snapshot: sessions.fork() registers a real child, and its
      // snapshot length is not the inherited cut.
      seed = sliceLiveSessionSeed(deps.binding.agent.session)
    } catch (error) { deps.notify(t('model-switch-fork-failed', { err: error instanceof Error ? error.message : String(error) }), { color: 'error' }); return false }
    const childId = SessionId(randomUUID())
    // Announce the id before the factory: from the moment `agents.create`
    // returns this process holds the only write handle on a log the publisher
    // will not name until its next beat.
    const { reservation } = await reserveNewSession(String(childId))
    const composed = await composePreset(ctx, runningPresetOf(deps.binding.agent.session))
    let candidate: AgentSession
    try {
      candidate = await deps.binding.prepare(adoption, async () => createDshSession(ctx, await agents.create(liveSessionCreateOptions({
        sessionId: childId,
        seed,
        runtimeSession: deps.binding.agent.session,
        inheritedCount: seed.length,
        cwd: state.sessions.ingress.read().cwd,
        // A session nobody has typed into has no conversation to relate, and
        // lineage would cost its first real prompt the generated title — the
        // child stands as its own root instead (session-lineage.ts).
        parentSession: childRecordsLineage(seed) ? deps.binding.agent.session.id : undefined,
        agentPreset: composed.agentPreset,
        agentOptions: { provider, model },
        setup: composed.setup,
      }))))
    } catch (error) { reservation.abandon(); deps.notify(t('model-switch-failed', { err: error instanceof Error ? error.message : String(error) }), { color: 'error', timeoutMs: 8000 }); return false }
    try { await attachSessionToWorkspace(ctx, state.sessions.ingress.read().cwd, childId) }
    catch (error) { deps.notify(t('model-switch-attach-failed', { err: error instanceof Error ? error.message : String(error) }), { color: 'warning', timeoutMs: 8000 }) }
    if (!deps.binding.isCurrent(adoption) || !deps.owner.current()) { await deps.binding.abandon(candidate); reservation.abandon(); return false }
    const handle = dshHandleOf(candidate)
    let committed = false
    try {
      const result = deps.binding.adopt<boolean>(candidate, adoption, (_previous, disposePrevious) => {
        resetSessionProjection(state, deps.rowIds, deps.resetProjector, deps.resetSubagents, deps.resetJobs)
        state.sessions.ingress.update(draft => { draft.status = handle.agent.status })
        state.sessions.ingress.update(draft => { draft.agentId = handle.agent.id })
        state.sessions.ingress.update(draft => { draft.sessionId = handle.agent.session.id })
        state.sessions.ingress.update(draft => { draft.agentPreset = composed.agentPreset })
        state.settings.ingress.update(draft => { draft.provider = provider })
        state.settings.ingress.update(draft => { draft.model = model })
        state.settings.ingress.update(draft => { draft.contextWindow = undefined })
        state.settings.ingress.update(draft => { draft.effortLevels = undefined })
        state.settings.ingress.update(draft => { draft.reasoningEffort = undefined })
        deps.dropModelCompletion()
        deps.replay(seed)
        deps.settleReplay()
        state.sessions.ingress.update(draft => { draft.working = handle.agent.status === 'running' })
        // Reset the input FIFO and pending-decision indicators BEFORE the first
        // emit: a submit from a session-changed subscriber must not chain onto
        // the replaced session's parked promise (main's bind → clear → refresh
        // order).
        deps.clearStagedImages()
        deps.bindAgent()
        deps.refreshCommands()
        void deps.refreshLoadedContext()
        void deps.refreshSkillCommands()
        touchSession(childId)
        publishRuntime(state)
        disposePrevious('dispose')
        if (!writeModelPref(provider, model)) deps.notify(t('model-pref-write-failed'), { color: 'warning' })
        return true
      })
      committed = true
      return result
    } finally {
      if (committed) reservation.settle()
      else reservation.abandon()
    }
  }
}
