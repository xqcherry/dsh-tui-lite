import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as toolAskUser from '@deepseek-ai/dsh-tool-ask-user'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { randomUUID } from 'node:crypto'
import React from 'react'
import { readEffortPref } from '../effortPrefs.js'
import { ownsAltScreenExit } from '../handoffAck.js'
import { t } from '../i18n.js'
import instances from '../ink/instances.js'
import { cursorMove, DISABLE_KITTY_KEYBOARD, DISABLE_MODIFY_OTHER_KEYS, DISABLE_WIN32_INPUT_MODE } from '../ink/termio/csi.js'
import { DBP, DFE, DISABLE_MOUSE_TRACKING, EXIT_ALT_SCREEN, SHOW_CURSOR } from '../ink/termio/dec.js'
import { CLEAR_ITERM2_PROGRESS, CLEAR_TAB_STATUS, supportsTabStatus, wrapForMultiplexer } from '../ink/termio/osc.js'
import { registerProcessGuardFatalSink } from '../ink/update-overflow-guard.js'
import { readModelPref } from '../modelPrefs.js'
import type { ModelRoute } from '../modelRoute.js'
import { explicitModelRoute, recordedModelRoute, resolveModelRoute, validateModelRoute } from '../modelRoute.js'
import { Chat } from '../screens/Chat.js'
import { resumeTargetFromArgv, writeResumeTarget } from '../sessionHistory.js'
import { reserveMount } from '../sessionMounts.js'
import { render } from '../ui.js'
import { logRestartEvent, resolveDshProfileName, restartTui, updateTuiAndRestart, writeHandoffNotice, type TuiRestartOptions } from '../update.js'
import { removeClipboardImageDir } from '../utils/clipboard.js'
import { appendCrashLog, serializeCrashDetail, unserializableCrashDetail, type CrashDetail } from '../utils/crashDetail.js'
import { logForDebugging } from '../utils/debug.js'
import { resolveSessionCwd } from '../utils/workspaceRoot.js'
import { ApprovalStore } from './approvals.js'
import { createDshSession } from './backend/session.js'
import { createChannel } from './channel.js'
import { createChildStderrReporter, installChildStderrGuard } from './childStderr.js'
import { ensureLegacySessionEventTypes, snapshotLiveSessionEvents } from './compat/index.js'
import { createContextOccupancyStore } from './context-occupancy.js'
import { ensureHostPreset } from './host-preset.js'
import type { Config } from './index.js'
import { isModelConfigured, type ModelConfigurationHost } from './model-configuration.js'
import { composePreset, resolvePersistedPreset, resolvePersistedRoute, runningPresetOf } from './presets.js'
import { prepareQuestionAnswerer } from './questions-answerer.js'
import { QuestionStore } from './questions.js'
import { startSessionMountHeartbeat } from './session-mount-heartbeat.js'
import { initialPromptFromCmdlineArgs } from './startup-args.js'
import { attachSessionToWorkspace } from './workspace.js'


export { initialPromptFromCmdlineArgs }

export type TuiHostMode = 'interactive' | 'invalid-explicit-launch' | 'headless-host'

export function resolveTuiHostMode(
  stdoutIsTTY = process.stdout.isTTY === true,
  env: NodeJS.ProcessEnv = process.env,
): TuiHostMode {
  if (stdoutIsTTY) return 'interactive'
  return env.DSH_TUI_LAUNCHER_VERSION !== undefined ? 'invalid-explicit-launch' : 'headless-host'
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  const hostMode = resolveTuiHostMode()
  if (hostMode === 'headless-host') return
  if (hostMode === 'invalid-explicit-launch') throw new Error('dsh-tui requires an interactive terminal')

  const questions = ctx.get('userQuestions') ?? new UserQuestionService(ctx)
  ctx.plugin(toolAskUser)
  const questionStore = new QuestionStore()
  const answerer = prepareQuestionAnswerer(ctx, questions, questionStore)
  ctx.effect(() => () => questionStore.rejectAll())

  const configured = { provider: config.provider, model: config.model }
  const selection = (ctx.get('agentDefaultModel') as {
    currentSelection?(): { provider?: string; model?: string }
  } | undefined)?.currentSelection?.()
  const fallback = explicitModelRoute(selection ?? {})
  const route = resolveModelRoute(configured, readModelPref(), fallback)
  const cwd = resolveSessionCwd(config.cwd ?? process.env.DSH_TUI_WORKSPACE_TARGET)
  const cmdline = ctx.get('cmdlineArgs') as { get?(): readonly string[]; args?: readonly string[] } | undefined
  const args = cmdline?.get?.() ?? cmdline?.args
  const sessionId = config.sessionId ?? resumeTargetFromArgv(args ?? process.argv.slice(2))
  await ensureHostPreset(ctx, config.preset)
  const { agent, handle, agentPreset, route: activeRoute } = await resolveAgent(
    ctx, sessionId, configured, route, { cwd }, config.preset,
  )
  await attachSessionToWorkspace(ctx, agent.session.header.cwd ?? cwd, agent.session.id)
  const contextStore = createContextOccupancyStore(ctx)
  const channel = createChannel(ctx, createDshSession(ctx, { agent, handle }), {
    ...(activeRoute ?? route),
    cwd: agent.session.header.cwd ?? cwd,
    effort: config.effort ?? readEffortPref(),
    configuredProvider: config.provider,
    configuredModel: config.model,
    configuredPreset: config.preset,
    agentPreset,
    contextPressure: contextStore,
    seedContextOccupancy: session => contextStore.seed(session),
  })
  if (answerer.kind === 'waterfall') answerer.register(channel)
  ctx.effect(() => () => { channel.releaseContributions() })
  ctx.effect(() => startSessionMountHeartbeat(ctx))

  const approvals = new ApprovalStore()
  if (ctx.get('approval') !== undefined) {
    ctx.on('approval/request', (request, next) => approvals.park(request).catch(() => next()))
    ctx.on('session/event', (session, event) => approvals.noteSessionEvent(session.id, event))
  }
  ctx.effect(() => () => approvals.settleAll('cancelled'))

  const stderrReporter = createChildStderrReporter(line => channel.notify(line, { color: 'warning' }))
  ctx.effect(() => {
    const restore = installChildStderrGuard(line => stderrReporter.push(line))
    return () => { restore(); stderrReporter.dispose() }
  })

  let instance: Awaited<ReturnType<typeof render>> | undefined
  let restart = false
  let update = false
  const profile = resolveDshProfileName()
  const funnel = createExitFunnel({ onUserExit: error => {
    if (error !== undefined) {
      runCrashExit({
        error,
        logError: message => ctx.logger.error(message),
        appendLog: appendCrashLog,
        logRestart: logRestartEvent,
        logDebug: logForDebugging,
        writeResumeMarkers: () => writeResumeTarget(channel.agentId),
        finish: notice => { void finishExit(ctx, instance, false, notice, undefined, () => disposeRootAndExit(ctx, 1)) },
      })
      return
    }
    try { writeResumeTarget(channel.agentId) } catch { /* best effort */ }
    const notice = `Resume: ${resumeCommand(profile, channel.agentId)}`
    void finishExit(ctx, instance, false, notice, undefined, () => {
      if (restart) runRestart(ctx, profile, channel.agentId)
      else if (update) runUpdate(ctx, profile, channel.agentId, undefined)
      else disposeRootAndExit(ctx, 0)
    })
  } })
  ctx.effect(() => () => {
    funnel.markTeardown()
    registerProcessGuardFatalSink(undefined)
    instance?.unmount()
  })
  registerProcessGuardFatalSink(funnel.handleExit)
  const modelConfigured = (): Promise<boolean> => isModelConfigured({
    llm: ctx.get('llm') as ModelConfigurationHost['llm'],
    settings: ctx.get('settings') as ModelConfigurationHost['settings'],
    credentials: ctx.get('credentials') as ModelConfigurationHost['credentials'],
    auth: (ctx.get('dshAuth') as { api?: ModelConfigurationHost['auth'] } | undefined)?.api,
  }, channel.provider, channel.model)
  const prompt = initialPromptFromCmdlineArgs(args)
  const ready = prompt ? await modelConfigured().catch(() => false) : false
  const tree = React.createElement(Chat, {
    channel,
    questionStore,
    approvalStore: approvals,
    modelConfigured,
    initialPrompt: ready ? undefined : prompt || undefined,
    onExit: () => funnel.handleExit(),
    onRestart: () => { restart = true; funnel.handleExit() },
    onUpdate: profile === undefined ? undefined : () => { update = true; funnel.handleExit() },
  })
  instance = await render(tree, { exitOnCtrlC: false, terminalImages: false })
  void instance.waitUntilExit().then(funnel.handleExit, funnel.handleExit)
  if (prompt && ready) channel.submit(prompt)
}

async function resolveAgent(
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


/**
 * Distinguish a user-driven exit from a cordis context teardown (issue #12).
 *
 * Both paths settle the Ink instance's exit promise, but only a user exit
 * (`/exit`, double Ctrl+C, render crash) may leave the process. A teardown —
 * the DSH launcher's boot-time recompose disposes every entry once — must
 * only unmount the UI: the recomposed tree re-runs `apply` and mounts a
 * fresh instance, so exiting here would kill the process mid-recompose
 * (the "flash back to bash with no error" symptom).
 *
 * `markTeardown` must run before the unmount that settles the exit promise
 * (the settle reaches `handleExit` through a microtask, so a same-tick flag
 * is always observed). Exported for scripts/verify-teardown-exit.tsx.
 */
export function createExitFunnel(deps: { onUserExit: (error?: unknown) => void }): {
  /**
   * Settle the exit once.
   * @returns true when this call ran the user-exit path (the funnel now owns
   *  the process), false when it was already settled or the tree is being
   *  torn down. A process-level crash backstop must fall back to Node's
   *  default crash on false instead of swallowing the error.
   */
  handleExit: (error?: unknown) => boolean
  markTeardown: () => void
} {
  let exited = false
  let teardown = false
  return {
    markTeardown: () => {
      teardown = true
    },
    handleExit: (error?: unknown) => {
      if (teardown) return false
      if (exited) return false
      exited = true
      deps.onUserExit(error)
      return true
    },
  }
}

/**
 * The exit funnel's crash tail, separate so scripts/verify-shutdown-fallback
 * can drive it with failing sinks:
 *
 *  - Diagnostics (serialization and every log sink) may fail: a throwing
 *    getter or Proxy trap on the error, or a sink that throws, falls back to
 *    unserializableCrashDetail and one more logging attempt. The funnel latch
 *    is already set here, so an exception escaping would skip the rest.
 *  - The resume markers (and the last-run record, via writeResumeMarkers)
 *    and the terminal cleanup (finish, then disposeRootAndExit(1)) always
 *    run, whatever happened to the diagnostics.
 */
export interface CrashExitDeps {
  /** The crash value itself (may be hostile: throwing getters, Proxy traps). */
  readonly error: unknown
  /** Serializer override (verify fault injection); default serializeCrashDetail. */
  readonly serialize?: (error: unknown) => CrashDetail
  /** One-line error log (ctx.logger.error). */
  readonly logError: (message: string) => void
  /** crash.log append (appendCrashLog). */
  readonly appendLog: (detail: CrashDetail) => void
  /** restart.log one-line event (logRestartEvent). */
  readonly logRestart: (event: string, data?: Record<string, unknown>) => void
  /** Debug log (logForDebugging). */
  readonly logDebug: (message: string, data?: Record<string, unknown>) => void
  /** Resume markers; best effort, isolated from the diagnostics' fate. */
  readonly writeResumeMarkers: () => void
  /** MUST-RUN terminal cleanup + exit(1) handoff (finishExit + dispose). */
  readonly finish: (crashLine: string) => void
}

export function runCrashExit(deps: CrashExitDeps): void {
  let detail: CrashDetail
  try {
    detail = (deps.serialize ?? serializeCrashDetail)(deps.error)
    deps.logError(`dsh-tui: exit after error: ${detail.summary}`)
    deps.appendLog(detail)
    deps.logRestart('crash', { summary: detail.summary, ...(detail.digest === undefined ? {} : { digest: detail.digest }) })
    deps.logDebug('dsh-tui: crash detail', { crash: detail.text })
  } catch {
    // Ultimate degradation: fixed literals only — never re-read the throwable,
    // never re-run the sink chain beyond one best-effort attempt.
    detail = unserializableCrashDetail()
    try {
      deps.logError(`dsh-tui: exit after error: ${detail.summary}`)
      deps.appendLog(detail)
      deps.logRestart('crash', { summary: detail.summary })
    } catch {
      // Nothing left to try — the cleanup below still must run.
    }
  }
  try {
    deps.writeResumeMarkers()
  } catch {
    // Resume persistence is best effort and must never block the exit.
  }
  deps.finish(`dsh-tui crashed: ${detail.message}`)
}

/**
 * Whether a user exit should leave the resume marker (and print the resume
 * hint). Must be judged against the LIVE session behind the channel, not the
 * boot-time agent apply() captured: /resume, /new and /model swap the active
 * agent (channel.agentId follows, the old handle is disposed), so the
 * captured reference can point at a stale session — wiping a marker the
 * resume path just wrote (boot empty → /resume into history) or rewriting it
 * to a fresh empty session (boot with history → /new). `liveAgent` is the
 * registry lookup of channel.agentId; it falls back to the captured agent
 * when the lookup misses. Exported for scripts/verify-exit-resume-marker.
 */
export function isExitResumable(deps: {
  pendingCount: number
  liveAgent: Agent | undefined
  /** Undefined when the session runs on a non-DSH backend: its id is never
   *  a DSH resume target. */
  startupAgent: Agent | undefined
}): boolean {
  const agent = deps.liveAgent ?? deps.startupAgent
  if (agent === undefined) return false
  return (
    deps.pendingCount > 0 ||
    snapshotLiveSessionEvents(agent.session).some(
      event => event.type === 'user/message' && event.data.source.kind === 'user',
    )
  )
}

type InkShutdownState = {
  detachForShutdown?: () => void
  /**
   * Full stdin detach for the /update child handoff (issues #284/#307):
   * removes the readable/data listeners and pauses the pump so the
   * lingering parent stops racing the restarted TUI for keypresses.
   */
  detachStdinForHandoff?: () => void
  /** Drain pending stdin bytes; the exit funnel re-drains after cleanup. */
  drainStdin?: () => void
  frontFrame?: { cursor?: { x: number; y: number } }
  displayCursor?: { x: number; y: number } | null
}

/**
 * Finish terminal I/O before handing control to a process-level exit action.
 * Exported for scripts/verify-shutdown-fallback.
 */
export async function finishExit(
  ctx: Context,
  instance: Awaited<ReturnType<typeof render>> | undefined,
  fullscreen: boolean,
  notice: string | undefined,
  stderrNotice: string | undefined,
  done: () => void,
  options: { keepAltScreen?: boolean } = {},
): Promise<void> {
  try {
    // Resolve the Ink runtime twice: the instances map is keyed by stdout
    // identity, so a replaced/overridden stdout misses it; the render()
    // handle is the caller's own instance and always matches (issue #522 —
    // a missed lookup skipped detachForShutdown, leaving the stdin pump,
    // TTY handlers and querier alive so the self-heal probe re-wrote
    // ENABLE_MOUSE_TRACKING after DISABLE_MOUSE_TRACKING had been sent).
    const fromMap = readInkShutdownState(instances.get(process.stdout))
    const fromHandle = instance === undefined ? undefined : readInkShutdownState(instance)
    // A handle that exposes neither detach hook is not an Ink runtime we can
    // latch (e.g. the fake render handles in shutdown regressions) — treat it
    // as a lookup miss so the full-unmount fallback below can still run.
    const runtime = fromMap ?? (
      fromHandle?.detachForShutdown === undefined && fromHandle?.detachStdinForHandoff === undefined
        ? undefined
        : fromHandle
    )
    if (runtime === undefined) {
      ctx.logger.debug('dsh-tui: Ink runtime unavailable during shutdown; using generic terminal cleanup')
      if (instance !== undefined) {
        ctx.logger.debug('dsh-tui: Ink shutdown using full unmount as the terminal-restore fallback')
        // Lookup-miss (custom stdout embedders / detach-less handles): the
        // registry cannot hand us the detach hooks, so run the full Ink
        // unmount first. It restores raw mode, alt screen and listeners
        // synchronously before the notice below is written — the process
        // must never hand a broken terminal back to the shell.
        try {
          instance.unmount()
        } catch {
          ctx.logger.debug('dsh-tui: Ink shutdown unmount fallback failed; continuing with generic terminal cleanup')
        }
      }
    } else if (fromMap === undefined) {
      ctx.logger.debug('dsh-tui: Ink runtime resolved from the render handle (instances map missed); detaching')
    }
    const cursor = fullscreen ? '' : cursorMoveToFrameEnd(runtime)

    try {
      runtime?.detachForShutdown?.()
      // The /update continuation spawns children that inherit this stdin;
      // strip the readable pump so the parent cannot swallow their input
      // (issues #284/#307). Harmless on plain exits — the process exits
      // right after this cleanup anyway.
      runtime?.detachStdinForHandoff?.()
    } catch {
      ctx.logger.debug('dsh-tui: Ink shutdown detach failed; continuing with generic terminal cleanup')
    }
    // Kernel-switch handoff (see handoffAck.ts):
    //  - keepAltScreen: the old process stays in the alternate screen across
    //    the spawn; it clears it and writes the switch notice there.
    //  - ownsAltScreenExit() false: this is a replacement exiting before its
    //    first frame, and the old process will close the alternate screen.
    const exitAlt = fullscreen && !(options.keepAltScreen === true) && ownsAltScreenExit() ? EXIT_ALT_SCREEN : ''
    const cleanup = [
      exitAlt,
      cursor,
      DISABLE_MOUSE_TRACKING,
      DISABLE_MODIFY_OTHER_KEYS,
      DISABLE_KITTY_KEYBOARD,
      DISABLE_WIN32_INPUT_MODE,
      DFE,
      DBP,
      SHOW_CURSOR,
      CLEAR_ITERM2_PROGRESS,
      supportsTabStatus() ? wrapForMultiplexer(CLEAR_TAB_STATUS) : '',
    ].join('')
    const suffix = notice === undefined ? '' : `${notice}\n`
    const restoreFrame = options.keepAltScreen === true ? '\x1b[2J\x1b[H' : ''
    await writeStream(process.stdout, `${restoreFrame}${cleanup}\r\n${suffix}`)
    // Re-drain AFTER the cleanup sequences have landed (#507): terminal
    // replies and mouse packets already in flight when the exit started
    // keep arriving while cleanup is being written — the detach-time drain
    // cannot see them. Unconsumed at process exit they land in the shell's
    // input queue (DECRPM/DA1/XTVERSION garbage pasted into the prompt).
    // 150ms settle covers reply RTT on slow links (ssh/ghostty is #522's
    // environment; 50ms proved too tight there) while staying well inside
    // the exit window the user already waits through.
    await new Promise<void>(resolve => setTimeout(resolve, 150))
    runtime?.drainStdin?.()
    if (stderrNotice !== undefined) {
      await writeStream(process.stderr, `\n${stderrNotice}\n`)
    }
  } catch {
    ctx.logger.debug('dsh-tui: terminal cleanup failed; continuing with process shutdown')
  }
  // Filesystem-only: the exported clipboard images live in a per-process
  // temp directory that nothing else removes.
  removeClipboardImageDir()
  done()
}

function readInkShutdownState(value: unknown): InkShutdownState | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  if (candidate.detachForShutdown !== undefined && typeof candidate.detachForShutdown !== 'function') return undefined
  if (candidate.detachStdinForHandoff !== undefined && typeof candidate.detachStdinForHandoff !== 'function') return undefined
  if (candidate.drainStdin !== undefined && typeof candidate.drainStdin !== 'function') return undefined
  if (candidate.frontFrame !== undefined && !isFrameState(candidate.frontFrame)) return undefined
  if (candidate.displayCursor !== undefined && candidate.displayCursor !== null && !isCursorState(candidate.displayCursor)) return undefined
  return value as InkShutdownState
}

function isFrameState(value: unknown): value is { cursor?: { x: number; y: number } } {
  if (value === null || typeof value !== 'object') return false
  const cursor = (value as Record<string, unknown>).cursor
  return cursor === undefined || isCursorState(cursor)
}

function isCursorState(value: unknown): value is { x: number; y: number } {
  if (value === null || typeof value !== 'object') return false
  const cursor = value as Record<string, unknown>
  return typeof cursor.x === 'number' && typeof cursor.y === 'number'
}

function cursorMoveToFrameEnd(runtime: InkShutdownState | undefined): string {
  const frame = runtime?.frontFrame?.cursor
  if (frame === undefined) return ''
  const parked = runtime?.displayCursor ?? frame
  return cursorMove(frame.x - parked.x, frame.y - parked.y)
}

function writeStream(stream: NodeJS.WriteStream, data: string): Promise<void> {
  if (data.length === 0) return Promise.resolve()
  return new Promise(resolve => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    const timer = setTimeout(finish, 1000)
    timer.unref()
    try {
      stream.write(data, () => {
        clearTimeout(timer)
        finish()
      })
    } catch {
      clearTimeout(timer)
      finish()
    }
  })
}

/**
 * Restart the TUI in place and resume the same session — the `/restart`
 * tail of `/reload`: the soft reload cannot re-read boot-time-only state
 * (cordis.yml root config, frozen fullscreen layout, newly built code), so
 * /restart respawns the process with the original argv through the same
 * terminal handoff the /update path uses, minus the installation step.
 * The resume contract is dual-written (env + resume.txt) before this runs.
 */
/**
 * The tail of a failed restart / update notice: how to resume the session —
 * or nothing, when there is none to resume (a backend session the CLI never
 * persisted hands over an empty id: a hint without an id would mislead).
 */
function preservedSessionTail(sessionId: string, hint: (sessionId: string) => string): string {
  return sessionId === '' ? '\n\n' : ` Your session is preserved — resume with:\n${hint(sessionId)}\n\n`
}

function runRestart(ctx: Context, profile: string | undefined, sessionId: string, hint: (sessionId: string) => string = id => resumeCommand(profile, id), options: TuiRestartOptions = {}): void {
  logRestartEvent('runRestart: entered, disposing cordis root')
  disposeRootAndThen(ctx, () => {
    logRestartEvent('runRestart: root disposed, starting restartTui')
    void restartTui(sessionId, options).then(
      restartCode => {
        logRestartEvent('runRestart: restartTui resolved', { restartCode })
        if (restartCode !== 0) {
          writeHandoffNotice(
            `\ndsh-tui restart failed to spawn (exit ${restartCode}).${preservedSessionTail(sessionId, hint)}`,
          )
        }
        process.exit(restartCode)
      },
      restartError => {
        const message = restartError instanceof Error ? restartError.message : String(restartError)
        logRestartEvent('runRestart: restartTui rejected', { message })
        writeHandoffNotice(
          `\ndsh-tui restart failed: ${message}.${preservedSessionTail(sessionId, hint)}`,
        )
        process.exit(1)
      },
    )
  })
}

function runUpdate(
  ctx: Context,
  profile: string | undefined,
  sessionId: string,
  targetVersion: string | undefined,
  hint: (sessionId: string) => string = id => resumeCommand(profile, id),
): void {
  disposeRootAndThen(ctx, () => {
    if (profile === undefined) {
      process.stderr.write(`\n${t('update-aborted-no-profile')}\n`)
      process.exit(1)
    }
    void updateTuiAndRestart(sessionId, profile, targetVersion).then(
      ({ updateCode, restartCode }) => {
        if (updateCode !== 0) {
          process.stderr.write(
            `\ndsh-tui update failed (exit ${updateCode}).${preservedSessionTail(sessionId, hint)}`,
          )
        }
        process.exit(restartCode)
      },
      updateError => {
        const message = updateError instanceof Error ? updateError.message : String(updateError)
        process.stderr.write(
          `\ndsh-tui update failed: ${message}.${preservedSessionTail(sessionId, hint)}`,
        )
        process.exit(1)
      },
    )
  })
}

/** Deferred runtime failures must restore the terminal and fail the process. */
export function handleStartupError(ctx: Context, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  void finishExit(ctx, undefined, false, undefined,
    `dsh-tui startup failed: ${message}`, () => disposeRootAndExit(ctx, 1))
}

/**
 * Dispose the whole application before process exit, with a bounded fallback.
 * Mirrors the deleted dsh-tui front-door exit semantics.
 */
function disposeRootAndExit(ctx: Context, code: number): void {
  disposeRootAndThen(ctx, () => process.exit(code), code)
}

/**
 * The real way back into a session after the TUI process is gone. The
 * package ships no `dsh-tui` bin — resuming means feeding the session id
 * through `DSH_TUI_RESUME_SESSION` (what cordis.patch.yml's `sessionId`
 * reads) and
 * booting the same profile; on Windows the repo's dsh-tui.cmd wrapper
 * does this via --resume + ~/.dsh-tui/resume.txt.
 */
function resumeCommand(profile: string | undefined, sessionId: string): string {
  const boot = profile === undefined ? 'dsh --config cordis.yml' : `dsh --profile ${profile}`
  return process.platform === 'win32'
    ? `dsh-tui --resume ${sessionId}`
    : `DSH_TUI_RESUME_SESSION=${sessionId} ${boot}`
}

/**
 * Dispose the Cordis tree, then run a process-level handoff action. The
 * fallback exit keeps the caller's intended code when disposal stalls — the
 * handoff (update/restart) may legitimately take longer than the bound, and
 * reporting failure on a clean exit would mislead wrapper scripts.
 */
function disposeRootAndThen(ctx: Context, done: () => void, fallbackCode = 1): void {
  const timer = setTimeout(() => {
    // Diagnosis for a stalled disposal: without this line the fallback exit
    // is indistinguishable from a successful handoff in the field.
    logRestartEvent('dispose: timeout, taking fallback exit', { fallbackCode })
    process.exit(fallbackCode)
  }, 5000)
  timer.unref()
  void ctx.root.fiber.dispose().then(
    () => {
      clearTimeout(timer)
      done()
    },
    () => {
      clearTimeout(timer)
      done()
    },
  )
}
