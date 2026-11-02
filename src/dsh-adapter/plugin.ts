import type { Context } from '@deepseek-ai/cordis'
import React from 'react'
import { createExitFunnel, runCrashExit } from '../shared/lifecycle/exit.js'
import { readEffortPref } from '../modules/settings/index.js'
import { readModelPref } from '../modules/settings/index.js'
import { resumeTargetFromArgv, writeResumeTarget } from '../modules/sessions/index.js'
import { explicitModelRoute, resolveModelRoute } from '../modules/settings/index.js'
import { registerProcessGuardFatalSink } from '../ink/update-overflow-guard.js'
import { finishExit } from '../terminal/shutdown.js'
import { AlternateScreen, render } from '../terminal/index.js'
import { isFullscreenEnabled } from '../shared/platform/fullscreen.js'
import { createWorkbenchBindings } from './workbench-bindings.js'
import { Chat } from '../modules/workbench/index.js'
import { appendCrashLog } from '../shared/platform/crashDetail.js'
import { logForDebugging } from '../shared/platform/debug.js'
import { resolveSessionCwd } from '../shared/platform/workspaceRoot.js'
import { resolveAgent } from './agent-lifecycle.js'
import { ApprovalStore } from './approvals.js'
import { createDshSession } from './backend/session.js'
import { createChannel } from './channel.js'
import { createChildStderrReporter, installChildStderrGuard } from './childStderr.js'
import { createContextOccupancyStore } from './context-occupancy.js'
import { assertUpstreamRuntime } from './contract.js'
import { ensureHostPreset } from './host-preset.js'
import type { Config } from './index.js'
import { isModelConfigured, type ModelConfigurationHost } from './model-configuration.js'
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
  assertUpstreamRuntime()

  const questions = ctx.get('userQuestions')
  if (questions === undefined) throw new Error('dsh-tui requires the dsh userQuestions service')
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
  if (answerer.kind === 'waterfall') answerer.register({ get agentId() { return channel.sessions.store.getSnapshot().agentId } })
  ctx.effect(() => () => { channel.dispose() })
  ctx.effect(() => startSessionMountHeartbeat(ctx))

  const approvals = new ApprovalStore()
  if (ctx.get('approval') !== undefined) {
    ctx.on('approval/request', (request, next) => approvals.park(request).catch(() => next()))
    ctx.on('session/event', (session, event) => approvals.noteSessionEvent(session.id, event))
  }
  ctx.effect(() => () => approvals.settleAll('cancelled'))

  const stderrReporter = createChildStderrReporter(line => channel.workbench.commands.notify(line, { color: 'warning' }))
  ctx.effect(() => {
    const restore = installChildStderrGuard(line => stderrReporter.push(line))
    return () => { restore(); stderrReporter.dispose() }
  })

  const fullscreen = isFullscreenEnabled()
  let instance: Awaited<ReturnType<typeof render>> | undefined
  const funnel = createExitFunnel({ onUserExit: error => {
    if (error !== undefined) {
      runCrashExit({
        error,
        logError: message => ctx.logger.error(message),
        appendLog: appendCrashLog,
        logRestart: logForDebugging,
        logDebug: logForDebugging,
        writeResumeMarkers: () => writeResumeTarget(channel.sessions.store.getSnapshot().agentId),
        finish: notice => { void finishExit(ctx, instance, fullscreen, notice, undefined, () => disposeRootAndExit(ctx, 1)) },
      })
      return
    }
    try { writeResumeTarget(channel.sessions.store.getSnapshot().agentId) } catch { /* best effort */ }
    const notice = `Resume: dsl --resume ${channel.sessions.store.getSnapshot().agentId}`
    void finishExit(ctx, instance, fullscreen, notice, undefined, () => {
      disposeRootAndExit(ctx, 0)
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
  }, channel.settings.store.getSnapshot().provider, channel.settings.store.getSnapshot().model)
  const prompt = initialPromptFromCmdlineArgs(args)
  const ready = prompt ? await modelConfigured().catch(() => false) : false
  const chat = React.createElement(Chat, {
    ports: createWorkbenchBindings(channel),
    questionStore,
    approvalStore: approvals,
    modelConfigured,
    initialPrompt: ready ? undefined : prompt || undefined,
    fullscreen,
    onExit: () => funnel.handleExit(),
  })
  const tree = fullscreen === false ? chat : React.createElement(AlternateScreen, null, chat)
  instance = await render(tree, { exitOnCtrlC: false, terminalImages: false })
  void instance.waitUntilExit().then(funnel.handleExit, funnel.handleExit)
  if (prompt && ready) channel.composer.commands.submit(prompt)
}

/** Deferred runtime failures must restore the terminal and fail the process. */
export function handleStartupError(ctx: Context, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  // Startup may fail before the UI mounted; EXIT_ALT_SCREEN is harmless when
  // the process never entered it, while skipping it would strand a partially
  // mounted tree on the alternate buffer.
  void finishExit(ctx, undefined, isFullscreenEnabled(), undefined,
    `dsh-tui startup failed: ${message}`, () => disposeRootAndExit(ctx, 1))
}

/**
 * Dispose the whole application before process exit, with a bounded fallback.
 * Mirrors the deleted dsh-tui front-door exit semantics.
 */
function disposeRootAndExit(ctx: Context, code: number): void {
  disposeRootAndThen(ctx, () => process.exit(code), code)
}

function disposeRootAndThen(ctx: Context, done: () => void, fallbackCode = 1): void {
  const timer = setTimeout(() => {
    // Diagnosis for a stalled disposal: without this line the fallback exit
    // is indistinguishable from a successful handoff in the field.
    logForDebugging('dispose: timeout, taking fallback exit', { fallbackCode })
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
