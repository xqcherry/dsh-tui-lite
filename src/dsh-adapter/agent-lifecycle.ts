import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import { reserveMount } from '../modules/sessions/index.js'
import type { ModelRoute } from '../modules/settings/contracts.js'
import { explicitModelRoute, recordedModelRoute, validateModelRoute } from '../modules/settings/index.js'
import { ensureLegacySessionEventTypes, snapshotLiveSessionEvents } from './compat/index.js'
import { composePreset, resolvePersistedPreset, resolvePersistedRoute, runningPresetOf } from './presets.js'

export async function resolveAgent(
  ctx: Context,
  requestedSessionId: string | undefined,
  configuredRoute: { provider?: string; model?: string },
  startupRoute: ModelRoute,
  meta: { cwd: string },
  configuredPreset?: string,
): Promise<{ agent: Agent; handle?: AgentHandle; agentPreset?: string; route?: ModelRoute }> {
  // Resume override (issue #67): cordis.yml overrides the target session's
  // recorded route only when it pins BOTH halves; undefined halves let the
  // session's own request/header records win (issue #30). The recorded route
  // is ALSO fed back into agentOptions (not just the status line): a resume
  // whose cordis.yml pins only `provider` would otherwise leave
  // agentOptions.model undefined, which breaks the `{{model}}` persona
  // variable for the resumed agent's own assembly and for every subagent it
  // spawns (dsh-subagent inherits `parent.options.model`).
  const resumeRoute = explicitModelRoute(configuredRoute)
  if (requestedSessionId !== undefined) {
    const resumeId = SessionId(requestedSessionId)
    const existing = ctx.agents.get(resumeId)
    if (existing !== undefined) {
      return { agent: existing, agentPreset: runningPresetOf(existing.session) }
    }
    // The launch-time counterpart of the in-session `/resume` claim
    // (`channel/session-resume.ts`), and it has to happen before ANY await:
    // without it `dsh-tui --resume <id>` mounts the log purely because the user
    // asked for it, so a second terminal doing the same joins the first and
    // both interleave writes into one append-only transcript. The mount
    // publisher cannot cover this — it publishes the set, it never refuses a
    // mount — so the claim is the only place the refusal can come from.
    //
    // Every failure refuses. "The ledger was busy" and "the ledger could not be
    // read" are not evidence that the session is free, and a boot that guesses
    // the wrong way here interleaves two writers into one append-only log —
    // the one outcome nothing downstream can repair. A genuinely read-only home
    // therefore costs a `--resume` refusal, which is loud and fixable, instead
    // of silent corruption.
    const reserved = await reserveMount(requestedSessionId)
    if (!reserved.ok) {
      if (reserved.reason === 'occupied') {
        throw new Error(
          `dsh-tui: cannot resume session "${requestedSessionId}": it is mounted by another TUI terminal ` +
          `(pid ${reserved.holders[0] ?? 0}) — two processes driving one session log would corrupt it. ` +
          'Close that terminal, or drop --resume to start a fresh session.',
        )
      }
      if (reserved.reason === 'busy') {
        throw new Error(
          `dsh-tui: cannot resume session "${requestedSessionId}": another process is holding the ` +
          'session mount ledger right now, so its occupancy could not be checked. Retry in a moment.',
        )
      }
      throw new Error(
        `dsh-tui: cannot resume session "${requestedSessionId}": its occupancy could not be verified ` +
        `(${reserved.detail}). Refusing rather than risk two processes writing one session log. ` +
        'If that file is damaged, remove it (and the matching .lock) while no other TUI is running, ' +
        'or drop --resume to start a fresh session.',
      )
    }
    // The reservation spans the awaits below: the agent only appears in the
    // registry once `agents.resume` returns, and a publisher beat landing in
    // between would otherwise drop the claim this boot just committed.
    const reservation = reserved.reservation
    try {
      // Compat boundary: register vouched-for legacy event types before the
      // strict read path (issue #153) — same seam as the /resume picker,
      // here for the launch-time --resume flow. In-process only.
      ensureLegacySessionEventTypes()
      // The resumed session keeps the preset its log records (last
      // `agent-preset/selected` wins over the creation header), never the
      // caller's current preference.
      const persisted = await resolvePersistedPreset(ctx, resumeId)
      const composed = await composePreset(ctx, persisted)
      const recorded = await resolvePersistedRoute(ctx, resumeId)
      const resumeOptions = {
        provider: resumeRoute?.provider ?? recorded?.provider,
        model: resumeRoute?.model ?? recorded?.model,
      }
      const resumed = await ctx.agents.resume({
        resumeSessionId: resumeId,
        agentOptions: resumeOptions,
        ...(composed.setup === undefined ? {} : { setup: composed.setup }),
      })
      // Status-line route on resume: the route the session actually
      // continues on — a complete cordis.yml pin, else the route its own
      // request/header records carry (a bare log yields undefined and the
      // caller falls back to the startup resolution, best effort).
      return {
        agent: resumed.agent,
        handle: resumed,
        agentPreset: composed.agentPreset,
        route: resumeRoute ?? recordedModelRoute(snapshotLiveSessionEvents(resumed.agent.session)),
      }
    } catch (error) {
      // A claim says "this process is driving the log". A resume that never
      // mounted must not leave one behind for a peer to see and refuse.
      reservation.abandon()
      // A launch-time --resume is an explicit request: silently substituting a
      // fresh session presents a cold conversation as the resumed one (the
      // "resume did nothing" failure mode — the warn below never reached a
      // terminal). Fail the boot loudly instead; the loader surfaces this to
      // stderr. The in-session /resume picker has its own error path.
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `dsh-tui: cannot resume session "${requestedSessionId}": ${reason} — ` +
        'the stored log is unreadable or corrupt; no fresh session was started instead. ' +
        'Drop --resume to start fresh, or repair the session log first.',
        { cause: error },
      )
    } finally {
      // The reservation only has to outlive the mount. From here the agent is
      // in the registry, which is what the publisher derives the set from.
      reservation.settle()
    }
  }
  const sessionId = SessionId(randomUUID())
  const composed = await composePreset(ctx, configuredPreset)
  // Fresh-session route precedence (issues #14/#30/#67): resolved atomically
  // by the caller (complete cordis.yml route > the persisted `/model` choice
  // > the harness default), then validated against the adapter catalog — a
  // stale persisted choice falls back to the default route wholesale instead
  // of reaching the server as an unknown model name.
  const llm = ctx.get('llm') as
    | { listModels(provider: string): Promise<readonly { id: string }[]> }
    | undefined
  const { route, rejected } = await validateModelRoute(llm, startupRoute)
  if (rejected !== undefined) {
    ctx.logger.warn(
      `dsh-tui: model route ${rejected.provider}/${rejected.model} is not advertised by provider "${rejected.provider}"; falling back to ${route.provider}/${route.model}`,
    )
  }
  // Reserve the fresh id before the factory, exactly like the in-session
  // creates: from the moment `agents.create` returns this process holds the
  // only write handle on a log the publisher has not named yet. A brand-new id
  // cannot conflict, so a refusal is only warned about — it costs
  // announcement, not correctness — but the reservation is what keeps the gap
  // between the create and the next beat from being open.
  const bootReserved = await reserveMount(String(sessionId))
  if (!bootReserved.ok && bootReserved.reason !== 'occupied') {
    ctx.logger.warn(`dsh-tui: could not announce the new session in the mount ledger: ${bootReserved.reason}`)
  }
  const bootReservation = bootReserved.ok ? bootReserved.reservation : undefined
  let created: Awaited<ReturnType<typeof ctx.agents.create>>
  try {
    created = await ctx.agents.create({
      sessionId,
      meta: {
        ...meta,
        // Durable header value: a later resume re-mounts exactly this preset.
        ...(composed.agentPreset === undefined ? {} : { agentPreset: composed.agentPreset }),
      },
      agentOptions: route,
      ...(composed.setup === undefined ? {} : { setup: composed.setup }),
    })
  } catch (error: unknown) {
    bootReservation?.abandon()
    // Fail loud with the reason on stderr — a dead TUI with no message is
    // the worst outcome for a misconfigured leaf (unknown provider/model).
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `dsh-tui: failed to create agent (provider=${route.provider}, model=${route.model}): ${message}`,
      { cause: error },
    )
  }
  bootReservation?.settle()
  return { agent: created.agent, handle: created, agentPreset: composed.agentPreset, route }
}
