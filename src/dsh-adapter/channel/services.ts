import { publishRuntime, type RuntimeCommands } from '../module-runtime.js'
/** Host-backed transcript, tools, session, model and permission actions. */
import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type { CommandRuntime } from '@deepseek-ai/dsh-commands'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { isCommandCompletionToken, LOCAL_COMMANDS } from '../../shared/commands.js'
import { DEFAULT_SESSION_MODES, resolveSessionModes } from '../../modules/sessions/index.js'
import { touchSession } from '../../modules/sessions/index.js'
import type { DshSession as AgentSession, DshSessionService as DshNative } from '../backend/session.js'
import { createDshTranslator, dshPricingWindow } from '../backend/translate.js'
import type { JobsRuntime } from '../jobs.js'
import { noteBranch } from '../sessions/index.js'
import type { ChannelActionDelegates } from './action-readiness.js'
import { createBindingEvents } from './binding-events.js'
import { agentCapabilityEvidence, annotateCommandCapabilities, resolveAgentCapabilities } from './capabilities.js'
import { channelCommands } from './commands.js'
import { createManualCompaction } from './compaction.js'
import type { CoreChannel } from './core/compose.js'
import { createExternalCommandInvoker } from './external-commands.js'
import { createJobProjection } from './job-projection.js'
import { createLoadedContextRefresher } from './loaded-context.js'
import { createLocalActions } from './local-actions.js'
import { mentionAttachments } from './mentions.js'
import { createPermissionModeActions } from './mode-permission-actions.js'
import { createPermissionModeRoster } from './mode-roster.js'
import { createModelActions } from './model-actions.js'
import { createModelSwitchAction } from './model-switch.js'
import { legacyPermissionPresetSnapshot, permissionPresetSnapshotFromService, unavailablePermissionPresetSnapshot } from './permissions.js'
import { createReportActions } from './reports.js'
import { createSessionMetadataActions } from './session-metadata.js'
import { createSessionResumeActions } from './session-resume.js'
import { createSkillCatalog } from './skill-catalog.js'
import { type ChannelLaunchOptions } from './state.js'
import { createSubagentProjection, type SubagentsServiceView } from './subagent-projection.js'
import { readChildTranscriptPage } from './subagent-transcript.js'
import { foldBack } from './transcript.js'

/**
 * Attach the DSH specialists to a core whose bound session is a DSH session.
 * Called inside `createChannel`'s construction transaction: a throw here is
 * rolled back by the caller through the core's owner.
 */
export function configureDshServices(
  core: CoreChannel,
  ctx: Context,
  initialNative: DshNative,
  options: ChannelLaunchOptions,
): void {
  const { state, owner, rowIds, notify } = core
  // The DSH specialists read the binding through its DSH view (the bound
  // session is a DSH session for this whole composition).
  const binding = core.binding
  /** The bound session's DSH escape hatch. */
  const dshNative = (): DshNative => {
    const native = binding.session.dsh
    if (native === undefined) throw new Error('dsh-tui: the bound session is not a DSH session')
    return native
  }
  // The DSH child transcript source (docs/dsh-child-transcript.md). Built
  // only when the host composition serves session persistence at attach;
  // without it there is no history method, so the shared transcript tab
  // never renders for this session. Every dependency is re-resolved per
  // call; the reader fences on the binding capture and closes its handle.
  const lookupChild = (id: string): { status?: string; session?: unknown; options?: { provider?: string; model?: string } } | undefined => {
    const agents = ctx.get('agents') as { get(id: string): { status?: string; session?: unknown; options?: { provider?: string; model?: string } } | undefined } | undefined
    return agents?.get(id)
  }
  const childTranscript = ctx.get('sessionPersistence') === undefined ? undefined : readChildTranscriptPage.bind(null, {
    capture: () => {
      const captured = binding.capture()
      return { sessionId: String(captured.agent.session.id), generation: captured.generation, session: captured.session }
    },
    isCurrent: capture => binding.isCurrent({ session: capture.session as never, agent: binding.agent, generation: capture.generation }),
    subagents: () => (ctx as { get(name: string): unknown }).get('subagents') as SubagentsServiceView | undefined,
    persistence: () => (ctx as { get(name: string): unknown }).get('sessionPersistence') as import('./subagent-transcript.js').ChildPersistenceSource | undefined,
    sessionsStore: () => (ctx as { get(name: string): unknown }).get('sessions') as import('./subagent-transcript.js').ChildSessionsStore | undefined,
    lookupChild,
    // A fresh translator per call, like backend/session.ts's `history()`,
    // so the live translator's frame fence and open-call ledger stay
    // untouched. The presenter scope is the parent agent: the child's own
    // Agent cannot be loaded without resuming it, and a wrong-scope
    // presenter only degrades a card to plain text.
    createTranslator: () => createDshTranslator({
      tools: () => ctx.get('tools') as import('./types.js').ToolsRegistryLike | undefined,
      scope: () => binding.agent,
      attachments: () => ctx.get('attachments'),
    }),
    ownerSignal: owner.signal,
  })
  // Subagent projection owns the child store, transcript row identity and
  // stream batching. Transport subscriptions below only route scoped events.
  const subagentProjection = createSubagentProjection(state.activity, state.transcript, {
    emit: () => publishRuntime(state),
    emitStream: () => publishRuntime(state, 'stream'),
    agent: () => binding.agent,
    // The continuation service is an optional host plugin: the projection's
    // message capability (direct prompt, catalog roster) exists only when the
    // service and its methods do.
    subagents: () => (ctx as { get(name: string): unknown }).get('subagents') as SubagentsServiceView | undefined,
    ownerSignal: owner.signal,
    lookupChild,
    ...(childTranscript === undefined ? {} : { readChildTranscript: childTranscript }),
  })
  owner.own(() => subagentProjection.dispose())
  // Job projection owns registry callbacks and transcript rows. The optional
  // service attachment has no authority after its injected lifetime ends.
  const jobProjection = createJobProjection(state.activity, state.transcript, {
    owner, notify: (...args) => notify(...args), emit: () => publishRuntime(state), agent: () => binding.agent, steer: text => channelCommands(state).steer(text),
  })

  // The DSH slash-command registry (optional service): /plan, /goal and
  // friends register here; the TUI merges their descriptors into the slash
  // menu and dispatches through `execute`.
  const commandService: CommandRuntime | undefined = ctx.get('commands')
  // Shift+Tab session-mode cycle: cordis.yml `modes` wins; absent/empty/
  // atom-less → the built-in default/plan/full cycle (sessionModes.ts).
  // Configured entries may additionally pin a durable `permission` preset
  // identity (permission + plan allowed; permission + sandbox/approval is
  // contradictory and dropped with a warning).
  const { modes: resolvedConfiguredSessionModes, dropped: droppedModeIds } = resolveSessionModes(options.modes)
  const filteredConfiguredSessionModes = resolvedConfiguredSessionModes
    .filter(spec => spec.permission === undefined || isCommandCompletionToken(spec.permission))
  const configuredSessionModes = filteredConfiguredSessionModes.length > 0
    ? filteredConfiguredSessionModes
    : DEFAULT_SESSION_MODES
  if (droppedModeIds.length > 0) {
    ctx.logger.warn(
      `dsh-tui: session modes ${droppedModeIds.map(id => `"${id}"`).join(', ')} declare no plan/sandbox/approval/permission atom; dropped from the Shift+Tab cycle`,
    )
  }
  // Runtime permission roster: third-party presets enter the Shift+Tab cycle
  // after the configured/default modes, rebuilt from the live service snapshot.
  const permissionRoster = createPermissionModeRoster(ctx, {
    configuredModes: configuredSessionModes,
    agent: () => binding.agent,
    warn: message => ctx.logger.warn(message),
  })
  const sessionModes = permissionRoster.modes

  // ── the DSH session's view of the common state ─────────────────────────
  const initialSession: AgentSession = binding.session
  state.sessions.ingress.update(draft => { draft.agentId = binding.agent.id })
  state.sessions.ingress.update(draft => { draft.sessionId = binding.agent.session.id })
  state.sessions.ingress.update(draft => { draft.mode = sessionModes[0]! })
  // A DSH session supports everything the TUI offers.

  // Capability facts for the bound agent (channel/capabilities.ts). Reads are
  // service lookups, so both consumers may call it freely: the public
  // `capabilities()` accessor and the command-list annotation below.
  const capabilitiesOf = () => resolveAgentCapabilities(agentCapabilityEvidence(ctx, binding.agent))
  // Annotated from the start: Help and `/` completion read `commandList`
  // before the first skill-catalog refresh publishes a new one, and a command
  // whose capability is missing must never look usable in that window.
  state.workbench.ingress.update(draft => { draft.commandList = annotateCommandCapabilities(LOCAL_COMMANDS, capabilitiesOf()) })
  state.activity.commands.subagentControl = subagentProjection.control
  state.activity.commands.jobControl = jobProjection.control
  state.sessions.commands.permissionPresets = () => {
    let service: unknown
    try {
      service = ctx.get('permissionPresets')
    } catch {
      return unavailablePermissionPresetSnapshot()
    }
    if (service === undefined) return legacyPermissionPresetSnapshot(state.sessions.ingress.read().mode.sandbox)
    return permissionPresetSnapshotFromService(service, binding.agent.session)
  }
  // The DSH log restores folded rows; the projector prices by the DeepSeek
  // rate window and feeds the job registry. Installed before the seed replay.
  const dshLocal = createLocalActions({
    ctx,
    owner,
    binding,
    state,
    // Fold restore re-derives views with the bound session's presenters.
    presenters: {
      call: (name, rawArgs) => dshNative().presentCallView(name, rawArgs),
      result: (name, rawArgs, data) => dshNative().presentResultView(name, rawArgs, data),
    },
    foldBack,
  })
  core.configure({
    flushDeferred: () => subagentProjection.flush(),
    loadOlder: dshLocal.loadOlder,
    // Subagents and jobs come from the DSH host services (projections above).
    // The DSH workspace may be remote: no local-disk stand-in for `fs`.
    dropRows: () => {
      subagentProjection.dropRows()
      jobProjection.dropRows()
    },
    touchSession: sessionId => { touchSession(sessionId) },
    // A session log records no branch; note it so the browser can show it.
    noteBranch: branch => { noteBranch(binding.agent.session.id, branch) },
    // `Client.capabilities()`: the agent's composition facts.
    agentCapabilities: capabilitiesOf,
  })
  core.feed.configureProjection({ jobs: jobProjection.store, pricingWindow: dshPricingWindow })
  const resetProjection = core.feed.resetProjection
  const projector = core.feed.projector

  // Model selection is installed by bind; route/effort state is owned by model-actions.
  const selection: ModelSelectionRef = { current: undefined, assembled: undefined }
  // Registry command policy and rc.8 image encoding are an owner-scoped module.
  const externalCommands = createExternalCommandInvoker(ctx, {
    commandService,
    agent: () => binding.agent,
    capture: () => binding.capture(),
    bindingCurrent: capture => binding.isCurrent(capture as ReturnType<typeof binding.capture>),
    composer: core.composer,
    attachments: () => mentionAttachments(ctx),
    notify: (...args) => notify(...args),
  })
  const executeRegistryCommand = externalCommands.invokeText

  // Session actions close over these inert placeholders; they are installed
  // below, before the channel starts.
  let settleManualCompaction!: () => Promise<void>
  // The injection callback may synchronously publish its initial list, so it
  // is installed only after the full action surface is ready (start).
  const startJobs = (): void => {
    if (typeof (ctx as { inject?: unknown }).inject === 'function') {
      ctx.inject(['jobs'], jobsCtx => {
        jobProjection.attach((jobsCtx as { jobs?: JobsRuntime }).jobs, dispose => jobsCtx.effect(() => dispose))
      })
    } else {
      jobProjection.attach((ctx as { get?: (name: string) => unknown }).get?.('jobs') as JobsRuntime | undefined)
    }
  }

  // Catalog/context services own their caches, registrations and async origin fences.
  const skillCatalog = createSkillCatalog(ctx, {
    owner,
    commandService,
    agent: () => binding.agent,
    cwd: () => state.sessions.ingress.read().cwd,
    setCommands(commands) {
      // Annotate before publishing: Help and `/` completion both read
      // `commandList`, so a command whose capability is missing says so
      // instead of looking usable and failing on use.
      state.workbench.ingress.update(draft => { draft.commandList = annotateCommandCapabilities(commands, capabilitiesOf()) })
      publishRuntime(state)
    },
    // Attached-context pass-through: the skill catalog never loses the
    // FIFO/decision fence.
    deliverUserText: (text, placement, attach) => core.input.deliverUserText(text, placement, [], attach),
  })
  const { viewOptions: skillViewOptions, registryFor: skillRegistryFor, refreshCommands: refreshCommandList, refreshSkillCommands } = skillCatalog
  // Each helper captures binding/cwd at invocation, rather than receiving a
  // root-state bag. Its late completions are rejected by owner + binding.
  const reportActions = createReportActions(ctx, {
    owner,
    capture: () => binding.capture(),
    current: capture => binding.isCurrent(capture as ReturnType<typeof binding.capture>),
    cwd: () => state.sessions.ingress.read().cwd,
    model: () => state.settings.ingress.read().model,
  })
  const sessionMetadataActions = createSessionMetadataActions(ctx, {
    owner,
    binding,
    provider: () => state.settings.ingress.read().provider,
    model: () => state.settings.ingress.read().model,
    emit: () => publishRuntime(state),
    sessionTitle: () => state.sessions.ingress.read().sessionTitle,
    setSessionTitle: title => { state.sessions.ingress.update(draft => { draft.sessionTitle = title }) },
    skillRegistryFor,
    skillViewOptions,
  })
  const loadedContext = createLoadedContextRefresher(ctx, {
    owner,
    agent: () => binding.agent,
    cwd: () => state.sessions.ingress.read().cwd,
    skillRegistryFor,
    skillViewOptions,
    publish(context) { state.transcript.ingress.update(draft => { draft.loadedContext = context }); publishRuntime(state) },
  })
  const refreshLoadedContext = loadedContext.refresh

  // Replay the durable transcript first, then follow live events. The same
  // seed re-populates the subagent dashboard's durable discovery facts
  // (`subagent/catalog`, workflow member edges) so a resumed session keeps
  // its dispatched-children history (issue #966). The seed is translated
  // synchronously by the bound session (adoption tails replay inside a
  // synchronous binding transaction, which the async `history()` cannot
  // serve); callers have already bound the session the seed belongs to.
  const replaySessionSeed = (events: readonly SessionEvent[]): void => {
    projector.apply(dshNative().translateReplay(events), { replay: true })
    subagentProjection.bootstrapFromLog(events)
  }
  replaySessionSeed(initialNative.rawHistory())
  projector.settleStreaming()
  // Attached to an idle agent: any replayed turn/start belongs to a previous
  // session run, so the spinner must not come up on boot.
  state.sessions.ingress.update(draft => { draft.working = false })
  state.composer.ingress.update(draft => { draft.cancelPending = false })
  state.sessions.ingress.update(draft => { draft.status = binding.agent.status })
  publishRuntime(state)

  const modelActions = createModelActions(ctx, state, {
    owner,
    binding,
    selection,
    initialEffort: options.effort,
    agent: () => binding.agent,
    notify,
    checkContextWarning: core.bookkeeping.checkContextWarning,
  })

  // The first bind (start) and every adoption tail bind through the core
  // feed, which runs the DSH binding-events hooks below.
  const bindAgent = (): void => { core.feed.bind() }
  const clearStagedImages = core.input.clearStagedImages

  const switchModelAction = createModelSwitchAction(ctx, state, {
    owner,
    binding,
    rowIds,
    // Compaction is installed below before the channel binds or exposes input.
    settleCompaction: () => settleManualCompaction(),
    resetProjector: resetProjection,
    resetSubagents: subagentProjection.reset,
    resetJobs: jobProjection.reset,
    replay: replaySessionSeed,
    settleReplay: projector.settleStreaming,
    bindAgent: () => bindAgent(),
    refreshCommands: refreshCommandList,
    refreshLoadedContext,
    refreshSkillCommands,
    clearStagedImages,
    dropModelCompletion: () => modelActions.dropModelNodeCache(),
    notify,
  })

  // This is the one necessary cyclic seam: mode actions need the completed
  // state, while the state exposes their command surface. It is assigned
  // before the channel starts binding/session observation.
  const modeActions = createPermissionModeActions(ctx, state, {
    owner,
    binding,
    sessionModes,
    roster: permissionRoster,
    commandService,
    executeRegistryCommand,
    notify,
  })

  // Event subscription routing is a distinct binding owner. Its hooks run in
  // every core bind: owner-level child listeners once, then per binding the
  // activity seed, the model selection waterfalls and the raw subscribers.
  const bindingEvents = createBindingEvents(ctx, {
    owner,
    binding,
    state,
    seedActivity: options.seedActivity,
    seedContextOccupancy: options.seedContextOccupancy,
    inputConvergence: core.inputConvergence,
    selection,
    modelActions,
    modeActions,
    projector,
    subagents: subagentProjection,
    retireAttachment: core.input.retireAttachment,
  })

  const resumeActions = createSessionResumeActions(ctx, state, {
    configuredPreset: options.configuredPreset,
    configuredProvider: options.configuredProvider,
    configuredModel: options.configuredModel,
    provider: options.provider,
    model: options.model,
  }, {
    owner,
    binding,
    rowIds,
    resetProjector: resetProjection,
    resetSubagents: subagentProjection.reset,
    resetJobs: jobProjection.reset,
    replay: replaySessionSeed,
    settleReplay: projector.settleStreaming,
    refreshGitBranch: () => core.refreshGitBranch(),
    bindAgent,
    refreshCommands: refreshCommandList,
    refreshLoadedContext,
    refreshSkillCommands,
    clearStagedImages,
    resetIdeSelection: core.resetIdeSelection,
    settleCompaction: () => settleManualCompaction(),
    notify,
  })
  const manualCompaction = createManualCompaction(ctx, state, {
    owner,
    agent: () => binding.agent,
    notify,
  })
  settleManualCompaction = manualCompaction.settle
  // Every action a DSH session serves beyond the core's (the type keeps this
  // table complete: a new public action must be placed on one side).
  const delegates = {
    runPermissionPreset: modeActions.runPermissionPreset,
    resumeTo: resumeActions.resumeTo,
    switchModel: switchModelAction,
    listEfforts: modelActions.listEfforts,
    setEffort: modelActions.setEffort,
    setDefaultEffort: modelActions.setDefaultEffort,
    cycleMode: modeActions.cycleMode,
    listModels: modelActions.listModels,
    listProviders: modelActions.listProviders,
    invalidateModelCompletion: modelActions.dropModelNodeCache,
    listSkills: sessionMetadataActions.listSkills,
    describeCredential: sessionMetadataActions.describeCredential,
    cachedSessions: sessionMetadataActions.cachedSessions,
    listSessions: sessionMetadataActions.listSessions,
    previewSession: sessionMetadataActions.previewSession,
    setResumeTarget: sessionMetadataActions.setResumeTarget,
    renameSession: sessionMetadataActions.renameSession,
    deleteSession: sessionMetadataActions.deleteSession,
    renameSessionTo: sessionMetadataActions.renameSessionTo,
    compact: manualCompaction.compact,
    cancelCompact: manualCompaction.cancel,
    runExternalCommand: externalCommands.invokeText,
    runExternalCommandOutcome: externalCommands.invoke,
    exportSession: reportActions.exportSession,
    listSubagents: dshLocal.listSubagents,
  } satisfies Partial<ChannelActionDelegates>

  core.configure({
    completions: { model: modelActions },
    bind: {
      ...bindingEvents.hooks,
      // Re-anchor the job projection after every bind: its event
      // subscription is deliberately owner-agnostic, so this is what makes
      // the /jobs roster follow a session switch immediately.
      afterBind: () => { jobProjection.reanchor() },
      resetTranslation: () => { binding.session.dsh?.resetTranslation() },
    },
    newSession: resumeActions.newSessionOpener,
    delegates,
    start: {
      before() {
        owner.own(ctx.on('commands/change', () => { if (owner.current()) modeActions.refreshMode() }))
      },
      after() {
        startJobs()
        skillCatalog.start()
        void refreshLoadedContext()
      },
    },
  })

  // Subagents inherit provider/model from AgentOptions, but resumed TUI
  // agents can legitimately carry their route only in persisted request
  // headers. Their child scopes do not share this channel's per-agent
  // ModelSelectionRef, so fill an otherwise incomplete first request from
  // the active route. Keep complete child-specific routes authoritative.
  // Registered before the first bind's own `agent/request` listener.
  const disposeInheritedChildRoute = ctx.on('agent/request', async (_payload, next) => {
    // This listener intentionally serves child scopes, not the bound agent's
    // selection pipeline. Capture the foreground route before awaiting so an
    // old child waterfall cannot borrow a later binding's model (A→B→A safe).
    const capture = binding.capture()
    const provider = state.settings.ingress.read().provider
    const model = state.settings.ingress.read().model
    const resolved = await next()
    if (!owner.current() || !binding.isCurrent(capture)) return resolved
    if (
      typeof resolved.provider === 'string' && resolved.provider.length > 0 &&
      typeof resolved.model === 'string' && resolved.model.length > 0
    ) {
      return resolved
    }
    return { ...resolved, provider, model }
  })
  owner.own(disposeInheritedChildRoute)
}
