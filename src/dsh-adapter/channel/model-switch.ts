import type { SessionsSnapshot } from '../../modules/sessions/contracts.js'
import type { SessionAdoptionFacts } from '../../modules/workbench/contracts.js'
import type { Notify } from '../../shared/protocol/notifications.js'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import type { ChannelOwner } from '../../shared/lifecycle/owner.js'
import { writeModelPref } from '../../modules/settings/index.js'
import { createModelFork, touchSession } from '../../modules/sessions/index.js'
import { reserveNewSession } from '../../modules/sessions/index.js'
import { createDshSession, dshHandleOf } from '../backend/session.js'
import { liveSessionCreateOptions, sliceLiveSessionSeed } from '../compat/index.js'
import { composePreset, runningPresetOf } from '../presets.js'
import { attachSessionToWorkspace } from '../workspace.js'
import type { ChannelBinding } from './binding.js'
import { childRecordsLineage } from './session-lineage.js'

type Binding = ChannelBinding
interface AdoptionPorts {
  session(): Readonly<Pick<SessionsSnapshot, 'cwd' | 'working'>>
  setWorking(working: boolean): void
  resetSession(facts: SessionAdoptionFacts): void
  publish(): void
}

/** Model-route adoption transaction. It settles compaction before its fork snapshot and owns the post-commit reset. */
export function createModelSwitchAction(
  ctx: Context,
  ports: AdoptionPorts,
  deps: {
    owner: Pick<ChannelOwner, 'current'>
    binding: Pick<Binding, 'agent' | 'capture' | 'prepare' | 'isCurrent' | 'abandon' | 'adopt'>
    settleCompaction(): Promise<void>
    replay(events: readonly SessionEvent[]): void
    settleReplay(): void
    bindAgent(): void
    refreshCommands(): void
    refreshLoadedContext(): Promise<void>
    refreshSkillCommands(): Promise<void>
    clearStagedImages(): void
    dropModelCompletion(): void
    notify: Notify
  },
) {
  return (provider: string, model: string): Promise<boolean> => {
    let agents: { create(options: CreateAgentOptions): Promise<AgentHandle> } | undefined
    return createModelFork({
      capture: deps.binding.capture,
      working: () => ports.session().working,
      available: () => { agents = ctx.get('agents') as typeof agents; return agents !== undefined },
      current: deps.owner.current,
      bindingCurrent: deps.binding.isCurrent,
      settleCompaction: deps.settleCompaction,
      snapshot: () => sliceLiveSessionSeed(deps.binding.agent.session),
      async reserve() {
        const childId = SessionId(randomUUID())
        const { reservation } = await reserveNewSession(String(childId))
        return { resource: childId, reservation }
      },
      preset: () => composePreset(ctx, runningPresetOf(deps.binding.agent.session)),
      prepare: (capture, childId, seed, composed, route) => deps.binding.prepare(capture, async () => {
        return createDshSession(ctx, await agents!.create(liveSessionCreateOptions({
          sessionId: childId,
          seed,
          runtimeSession: deps.binding.agent.session,
          inheritedCount: seed.length,
          cwd: ports.session().cwd,
          // Empty sessions remain roots so their first prompt owns the title.
          parentSession: childRecordsLineage(seed) ? deps.binding.agent.session.id : undefined,
          agentPreset: composed.agentPreset,
          agentOptions: route,
          setup: composed.setup,
        })))
      }),
      async attach(childId) { await attachSessionToWorkspace(ctx, ports.session().cwd, childId) },
      abandon: deps.binding.abandon,
      adopt: (candidate, capture, tail) => deps.binding.adopt(candidate, capture, (_previous, disposePrevious) => tail(disposePrevious)),
      reset(candidate, composed, route) {
        const { agent } = dshHandleOf(candidate)
        ports.resetSession({
          identity: { status: agent.status, agentId: agent.id, sessionId: agent.session.id, agentPreset: composed.agentPreset },
          route,
          clearLoadedContext: false,
        })
      },
      dropModelCompletion: deps.dropModelCompletion,
      replay: deps.replay,
      settleReplay: deps.settleReplay,
      setReplayStatus: candidate => ports.setWorking(dshHandleOf(candidate).agent.status === 'running'),
      clearStagedImages: deps.clearStagedImages,
      bindAgent: deps.bindAgent,
      refreshCommands: deps.refreshCommands,
      refreshLoadedContext: deps.refreshLoadedContext,
      refreshSkillCommands: deps.refreshSkillCommands,
      remember: childId => touchSession(childId),
      publish: () => ports.publish(),
      writeModelPref,
      notify: deps.notify,
    })(provider, model)
  }
}
