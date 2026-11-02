import { resetConversationProjection, createWorkbenchProjection } from '../../../modules/workbench/index.js'
import type { Notify } from '../../../shared/protocol/notifications.js'
import type { WorkbenchCommandHost } from '../../../modules/workbench/contracts.js'
import type { ActivityCommandHost } from '../../../modules/activity/contracts.js'
import type { TranscriptCommandHost } from '../../../modules/transcript/contracts.js'
import type { ComposerCommandHost } from '../../../modules/composer/contracts.js'
import type { SettingsCommandHost } from '../../../modules/settings/contracts.js'
import type { SessionsCommandHost } from '../../../modules/sessions/contracts.js'
/** Client runtime assembly for dsh: acquire, configure host services, then start. */
import type { Context } from '@deepseek-ai/cordis'
import { LOCAL_COMMANDS } from '../../../shared/commands.js'
import type { AgentCapabilities } from '../../../shared/protocol/agent-capabilities.js'
import { t } from '../../../shared/i18n.js'
import { createInputActions, type InputConvergence } from '../../../modules/composer/index.js'
import { registerChannelOwner, type ChannelOwner } from '../../../shared/lifecycle/owner.js'
import { DEFAULT_SESSION_MODES } from '../../../modules/sessions/index.js'
import { createPublication } from '../../../shared/state/module-store.js'
import { swallowNestedUpdateOverflow } from '../../../ink/update-overflow-guard.js'
import { bindRuntimePublisher, publishRuntime, type RuntimeModules } from '../../module-runtime.js'
import { createSessionsModule } from '../../../modules/sessions/index.js'
import { createSettingsModule } from '../../../modules/settings/index.js'
import { createComposerModule } from '../../../modules/composer/index.js'
import { createTranscriptModule } from '../../../modules/transcript/index.js'
import { createActivityModule } from '../../../modules/activity/index.js'
import { createWorkbenchModule } from '../../../modules/workbench/index.js'
import { createChannelNotifications } from '../../../modules/workbench/index.js'
import type { DshSession as AgentSession } from '../../backend/session.js'
import { resolveContextOccupancy } from '../../context-occupancy.js'
import { IdeChannel, ideLockDir, type SelectionSnapshot } from '../../ide-channel.js'
import { createChannelBinding, type ChannelBinding } from '../binding.js'
import { createComposerImages } from '../composer-images.js'
import { createContextBookkeeping } from '../context-bookkeeping.js'
import { createChannelEmitter } from '../emitter.js'
import { createSelectionAttachments } from '../ide-selection.js'
import { createInputDelivery } from '../input-delivery.js'
import { unavailablePermissionPresetSnapshot } from '../permissions.js'
import { createSettingsHosts } from '../settings-host.js'
import type { ChannelLaunchOptions } from '../state.js'
import { createBindingFeed, type BindingFeedHooks } from './binding-feed.js'
import { createCoreFiles, NO_COMPLETION_CATALOG, type CompletionCatalog } from './files.js'
import { createGitBranchRefresher } from './host.js'
import { createCoreLocalActions } from './local-actions.js'
import { createCoreReports } from './reports.js'
import { createSessionSwitch, type NewSessionOpener } from './session-switch.js'
import { readHarnessVersion } from '../../contract.js'

/** Token buffer below the context window at which the context-low warning fires. */
const CONTEXT_WARNING_BUFFER_TOKENS = 20_000

/** Initial job hooks are replaced by the dsh job projection before startup. */
const NO_JOB_FEED = { onOutputSeen: () => undefined, onStarted: () => undefined }

/** Internal startup wiring, configured before subscriptions become active. */
export interface ChannelServices {
  flushDeferred?(): boolean
  loadOlder?(): number
  dropRows?(): void
  touchSession?(sessionId: string): void
  noteBranch?(branch: string): void
  completions?: CompletionCatalog
  agentCapabilities?(): AgentCapabilities
  bind?: BindingFeedHooks
  newSession?: NewSessionOpener
  sessions?: Partial<SessionsCommandHost>
  settings?: Partial<SettingsCommandHost>
  composer?: Partial<ComposerCommandHost>
  transcript?: Partial<TranscriptCommandHost>
  activity?: Partial<ActivityCommandHost>
  workbench?: Partial<WorkbenchCommandHost>
  start?: { before?(): void; after?(): void }
}

/** Host service wiring consumes this runtime assembly. */
export type CoreChannel = ReturnType<typeof createCoreChannel>

export function createCoreChannel(
  ctx: Context,
  initialSession: AgentSession,
  options: ChannelLaunchOptions,
  owner: ChannelOwner,
) {
  const rowIds = { value: 0 }
  let emitter: ReturnType<typeof createChannelEmitter> | undefined
  const publication = createPublication({
    onListenerError(error) {
      if (!swallowNestedUpdateOverflow(error, 'module.publish')) throw error
    },
    schedule(callback) {
      const timer = setTimeout(() => {
        publication.batch(() => { emitter?.flushStream() }, 'silent')
        callback()
      }, 16)
      timer.unref()
      return () => clearTimeout(timer)
    },
  })
  const binding: ChannelBinding = createChannelBinding(initialSession, owner, publication)
  // Release the session and its subscriptions when this runtime ends.

  let services: ChannelServices = {}
  let started = false

  const launch = { options: { ...options, backendVersion: readHarnessVersion() }, input: { agentId: initialSession.sessionId, sessionId: initialSession.sessionId, mode: DEFAULT_SESSION_MODES[0]!, cwdDescription: options.cwd } }
  const state: RuntimeModules = {
    publication,
    sessions: createSessionsModule(launch, publication),
    settings: createSettingsModule(launch, publication),
    composer: createComposerModule(launch, publication),
    transcript: createTranscriptModule(launch, publication, rowIds),
    activity: createActivityModule(launch, publication),
    workbench: createWorkbenchModule(launch, publication),
    dispose() { owner.dispose() },
  }
  owner.own(() => {
    publication.dispose()
    state.sessions.dispose()
    state.settings.dispose()
    state.composer.dispose()
    state.transcript.dispose()
    state.activity.dispose()
    state.workbench.dispose()
  })

  emitter = createChannelEmitter({ batch: publication.batch, prepareEmission: state.transcript.ingress.prepareEmission }, () => services.flushDeferred?.() ?? false, {
    // Folding drops a row's full text on the promise that `loadOlder`
    // restores it; without a history slicer every row stays whole. A
    // session's durable transcript restores only rows with a stable anchor.
    fold: () => services.loadOlder !== undefined,
    restorable: row => services.loadOlder !== undefined,
  })
  // The emitter exists before the complete state surface. Put it in the
  // construction rollback funnel immediately; normal release remains
  // idempotent through the same disposer.
  owner.own(() => emitter?.dispose())
  bindRuntimePublisher(state, mode => {
    publication.batch(() => {
      state.transcript.ingress.setContextOccupancy(resolveContextOccupancy(options.contextPressure?.read(state.sessions.ingress.read().sessionId), state.transcript.ingress.read().lastUsage, state.settings.ingress.read().contextWindow))
      emitter?.emit(mode)
    }, mode)
  })
  const notifications = createChannelNotifications(state.workbench, owner)
  const notify: Notify = (...args) => owner.current() ? notifications(...args) : () => undefined
  /** The explicit failure every unbacked action reports. */
  const unavailable = (name: string): void => {
    notify(t('capability-unavailable-backend', { name }), { color: 'warning', timeoutMs: 4000 })
  }
  const unavailableLines = (name: string): string[] => [t('capability-unavailable-backend', { name })]
  /** "Load earlier" through the session's durable transcript: restore the
   *  folded rows first, then prepend the next older slice. */
  const bookkeeping = createContextBookkeeping(
    { occupancy: () => state.transcript.ingress.read().contextOccupancy, trackPending: state.composer.ingress.trackPending, untrackPending: state.composer.ingress.untrackPending },
    (text, notifyOptions) => notify(text, notifyOptions),
    percent => t('context-low-warning', { percent }),
    CONTEXT_WARNING_BUFFER_TOKENS,
    () => resolveContextOccupancy(options.contextPressure?.read(state.sessions.ingress.read().sessionId), state.transcript.ingress.read().lastUsage, state.settings.ingress.read().contextWindow),
  )
  const { resetContextWarning, checkContextWarning, trackPending, untrackPending } = bookkeeping

  // IDE selection link: one IdeChannel per channel, started in the
  // background against the session cwd (lock discovery needs it; env
  // direct-connect does not). start() never throws and degrades on its
  // own, so a missing IDE costs nothing and startup never waits on the
  // loopback dial.
  const ideChannel = new IdeChannel()
  // The loopback link lives outside every other owner: own its stop at once
  // so a construction failure past this line releases it (`stop` is
  // idempotent; `releaseContributions` stops it again in its finally).
  owner.own(() => { ideChannel.stop() })
  void ideChannel.start(process.env, ideLockDir(), options.cwd).catch(() => {})
  let currentSelection: SelectionSnapshot | undefined
  ideChannel.onSelection(snapshot => {
    // The channel already clears empty snapshots internally; mirror that here
    // so consumption reads one consistent variable.
    currentSelection = snapshot.isEmpty ? undefined : snapshot
    // Live prompt-footer badge: the selection must reach the screen before
    // the user submits. emit() bumps `version` so the useSyncExternalStore
    // tree re-renders with the new badge immediately.
    state.composer.ingress.setSelection(currentSelection)
    publishRuntime(state)
  })
  /**
   * Re-target the IDE selection link when the session's working directory
   * changes (/resume, /workspace, /new, an adopted background session).
   * Otherwise a selection from the old workspace stays visible (the badge
   * shows it and the next submit attaches the wrong file) and the old link
   * keeps pushing the old window's selections into the new one. rebind()
   * drops the link and rediscovers against the new cwd. Callers set
   * state.cwd before this runs, so it reads the fresh value.
   */
  const resetIdeSelection = (): void => {
    currentSelection = undefined
    state.composer.ingress.setSelection(undefined)
    publishRuntime(state)
    void ideChannel.rebind(state.sessions.ingress.read().cwd).catch(() => {})
  }
  const selectionAttachments = createSelectionAttachments()
  // "Send to Chat": staged panel contexts are session-scoped like the
  // selection above. The registry writes through the live state, so every
  // session-projection reset clears them with everything else, and the
  // submit path takes them all in one step. Backend-neutral: the context is
  // sent as one more text block of the submission.
  /**
   * Images for a session that takes them itself (the `images` capability):
   * held in memory by the core (local-images.ts), under the bound session's
   * limits; a DSH session keeps the attachments service.
   */
  const composer = createComposerImages(ctx, owner, { generation: () => state.sessions.ingress.read().agentBindingGeneration })
  const files = createCoreFiles(ctx, {
    owner,
    binding,
    cwd: () => state.sessions.ingress.read().cwd,
    commands: () => state.workbench.ingress.read().commandList,
    settings: state.settings.ingress.read,
    permissionPresets: () => state.sessions.commands.permissionPresets(),
    // Read late: the session controls are built after the files.
  })
  const inputDelivery = createInputDelivery(ctx, owner, binding, state.sessions.ingress.read,
    (...args) => notify(...args), trackPending, untrackPending, composer,
    () => currentSelection, (messageId, info) => selectionAttachments.remember(messageId, info),
    )
  const { dispatchUserText, clearStagedImages } = inputDelivery
  /** Monotonic token: only the latest `interruptAndDeliver` re-queues, so a
   *  second interrupt while the abort settles cannot double-deliver. */
  const inputConvergence = state.composer.ingress.convergence
  /**
   * Monotonic counter for parent-mediated message intents. The intentId
   * names the local submission only. It is never a durable message id, and
   * the parent's own SendMessage call (whenever the model makes it) is
   * matched by its call id, not by this.
   */
  const contextPressure = options.contextPressure
  const inputActions = createInputActions(() => ({ composer: state.composer, agentId: () => state.sessions.ingress.read().agentId, notify }), () => binding.session, owner, inputConvergence,
      composer,
      (text, placement, images) => dispatchUserText(text, placement, images),
      (command, includeInContext) => local.runLocalCommand(command, includeInContext),
      sessionId => { services.touchSession?.(sessionId) })

  state.workbench.ingress.setCommands(LOCAL_COMMANDS)

  // Register the raw state before any services can synchronously publish a
  // callback. The renderer lease binds its external authority later, but this
  // owner already makes teardown and construction failure fail closed.
  registerChannelOwner(state, owner)

  // The projection's change feed is the only thing that can move occupancy
  // between session events (a compaction rewriting the surface, the prompt
  // growing before the next request); republish so the footer, the status
  // commands and the warning read the fresh value immediately. The store is
  // host-wide and the emit is unconditional; the accessor already ignores
  // another session's value.
  if (contextPressure !== undefined) {
    owner.own(contextPressure.subscribe(() => {
      if (owner.current()) publishRuntime(state)
    }))
  }

  const feed = createBindingFeed(ctx, {
    owner,
    binding,
    batch: publication.batch,
    setBindingGeneration: state.sessions.ingress.setBindingGeneration,
    resetInputConvergence: state.composer.ingress.resetBindingConvergence,
    createProjection: deps => createWorkbenchProjection(state, deps),
    routing: {
      sessions: { projectionContext: state.sessions.ingress.projectionContext, setStatus: state.sessions.ingress.setStatus, setWorking: state.sessions.ingress.setWorking },
      composer: { clearCancellation: state.composer.ingress.clearCancellation, retirePending: state.composer.ingress.retirePending },
      transcript: { releaseActiveTools: state.transcript.ingress.releaseActiveTools },
      publication: { batch: publication.batch },
      publish: mode => publishRuntime(state, mode),
    },
    projection: {
      rowIds, resetContextWarning,
      jobs: NO_JOB_FEED,
      checkContextWarning, notify: (...args) => notify(...args),
      selectionAttached: messageId => selectionAttachments.take(messageId),
    },
    retireAttachment: inputDelivery.retireAttachment,
    hooks: () => services.bind ?? {},
    onReset: event => { resetConversation(event) },
  })
  /**
   * The backend reset the conversation in place (Claude `conversation_reset`:
   * a plan-mode exit that clears the context, a fresh-session flow). The
   * rows, subagent and job rosters, usage, cost and title all belonged to
   * the discarded conversation, so they go as on a session switch and a
   * notice row says why. Queued inputs stay (the backend still runs them).
   * Unlike the TUI's own view-only `/clear`, this follows a reset the
   * backend made.
   */
  const resetConversation = (event: { readonly trigger: string }): void => {
    resetConversationProjection(state, rowIds, event.trigger, {
      resetProjector: feed.resetProjection,
      dropRows: () => services.dropRows?.(),
      resetContextWarning,
      publish: () => publishRuntime(state),
    })
  }

  /** `!!` commands on their way to the session (`/new` waits them out). */
  const shellInputs = { started: 0, inFlight: 0 }
  const sessionSwitch = createSessionSwitch(ctx, {
    owner,
    binding,
    read: () => ({ cwd: state.sessions.ingress.read().cwd, working: state.sessions.ingress.read().working, pending: state.composer.ingress.read().pending }),
    commitWorkspace: state.sessions.ingress.adoptWorkspace,
    notify,
    resetIdeSelection,
    clearStagedImages,
    opener: () => services.newSession,
    activity: () => {
      const fifo = inputDelivery.activity()
      return {
        inputs: fifo.dispatched + shellInputs.started,
        unsettled: fifo.unsettled || shellInputs.inFlight > 0,
        turnStarts: feed.router.turnStarts(),
        ...(fifo.parked !== undefined ? { parked: fifo.parked } : shellInputs.inFlight > 0 ? { parked: '!!' } : {}),
      }
    },
    unavailable,
  })
  /** `/new` and `/resume` on a session no services claims: the backend's
   *  own `open`. */
  const local = createCoreLocalActions(ctx, {
    owner,
    binding,
    cwd: () => state.sessions.ingress.read().cwd,
    resetRows: state.transcript.ingress.resetRows,
    clearResponseActivity: state.transcript.ingress.clearResponseActivity,
    appendLocalRow: state.transcript.ingress.appendLocalRow,
    publish: () => publishRuntime(state),
    rowIds,
    resetProjection: feed.resetProjection,
    notify,
    unavailable,
    dropRows: () => {
      services.dropRows?.()
    },
    loadOlder: () => services.loadOlder,
    beginInput: () => {
      shellInputs.started += 1
      shellInputs.inFlight += 1
      let ended = false
      return () => {
        if (ended) return
        ended = true
        shellInputs.inFlight -= 1
      }
    },
  })
  const reports = createCoreReports({ owner, binding,
    session: state.sessions.ingress.read,
    settings: state.settings.ingress.read,
    rows: () => state.transcript.ingress.read().rows,
  })
  const refreshGitBranch = createGitBranchRefresher(ctx, {
    owner,
    cwd: () => state.sessions.ingress.read().cwd,
    setGitBranch: state.sessions.ingress.setGitBranch,
    publish: () => publishRuntime(state),
    noteBranch: branch => { services.noteBranch?.(branch) },
  })

  return {
    state,
    owner,
    binding,
    rowIds,
    notify,
    unavailable,
    bookkeeping,
    composer,
    input: inputDelivery,
    feed,
    sessionSwitch,
    local,
    files,
    reports,
    resetIdeSelection,
    refreshGitBranch,
    /** Merge an services's contributions (before `start`). */
    configure(next: ChannelServices): void {
      if (started) throw new Error('dsh-tui: Channel extensions must attach before the channel starts')
      services = {
        ...services,
        ...next,
        sessions: { ...services.sessions, ...next.sessions },
        settings: { ...services.settings, ...next.settings },
        composer: { ...services.composer, ...next.composer },
        transcript: { ...services.transcript, ...next.transcript },
        activity: { ...services.activity, ...next.activity },
        workbench: { ...services.workbench, ...next.workbench },
      }
    },
    /** Install the actions, start the runtime, bind the session. */
    start(): RuntimeModules {
      if (started) throw new Error('dsh-tui: Channel already started')
      started = true
      const refuse = <T>(name: string, value: T): T => { unavailable(name); return value }
      const refuseAsync = <T>(name: string, value: T): Promise<T> => Promise.resolve(refuse(name, value))
      state.sessions.connectHost({
        resumeTo: () => refuseAsync('resume', { ok: false, reason: 'unavailable' } as const),
        newSession: () => sessionSwitch.newSession(),
        cachedSessions: () => undefined,
        listSessions: () => refuseAsync('resume', []),
        previewSession: () => refuseAsync('resume', []),
        setResumeTarget: () => { unavailable('resume') },
        setSessionColor: () => { unavailable('color') },
        renameSession: () => { unavailable('rename') },
        deleteSession: () => refuseAsync('resume', false),
        renameSessionTo: () => refuseAsync('rename', false),
        capabilities: () => services.agentCapabilities?.() ?? { compact: { route: 'none', reasonKey: 'capability-reason-no-compaction' }, plan: { route: 'none', reasonKey: 'capability-reason-no-plan-command' }, compaction: false, pruner: false, questionTool: false, skills: false },
        cycleMode: () => refuseAsync('mode', undefined),
        permissionPresets: () => unavailablePermissionPresetSnapshot(),
        runPermissionPreset: () => refuseAsync('permission', false),
        ...services.sessions,
      })
      state.settings.connectHost({
        ...createSettingsHosts(ctx, owner.assertActive),
        switchModel: () => refuseAsync('model', false),
        listEfforts: () => refuseAsync('effort', { efforts: [], defaultEffort: undefined }),
        setEffort: () => refuseAsync('effort', false),
        setDefaultEffort: () => undefined,
        listModels: () => refuseAsync('model', []),
        listProviders: () => refuseAsync('provider', []),
        invalidateModelCompletion: () => undefined,
        describeCredential: () => refuseAsync('login', undefined),
        listSkills: () => refuseAsync('skills', undefined),
        ...services.settings,
      })
      state.composer.connectHost({
        ...inputActions,
        stagedImageGeneration: composer.stagedImageGeneration,
        stageImage: composer.stageImage,
        stageComposerImage: composer.stageComposerImage,
        hasStagedImage: composer.hasStagedImage,
        discardStagedImage: composer.discardStagedImage,
        stagedImage: composer.stagedImage,
        stagedImageLimits: composer.stagedImageLimits,
        commandCompletions: files.commandCompletions(services.completions ?? NO_COMPLETION_CATALOG),
        listFileCandidates: files.listFileCandidates,
        listFiles: files.listFiles,
        ...services.composer,
      })
      state.transcript.connectHost({
        clear: local.clear,
        loadOlder: local.loadOlder,
        compact: () => { unavailable('compact') },
        cancelCompact: () => undefined,
        exportSession: reports.exportSession,
        pushLocal: local.pushLocal,
        ...services.transcript,
      })
      state.activity.connectHost({
        listSubagents: () => Promise.resolve(unavailableLines('agents')),
        jobControl: { kill: () => false, watchOutput: () => () => undefined },
        subagentControl: { interrupt: () => false },
        ...services.activity,
      })
      state.workbench.connectHost({
        notify: notifications,
        runExternalCommand: () => Promise.resolve(undefined),
        runExternalCommandOutcome: () => Promise.resolve(undefined),
        mcpStatus: () => unavailableLines('mcp'),
        initWorkspace: () => refuse('init', null),
        doctorInfo: reports.doctorInfo,
        ...services.workbench,
      })
      for (const module of [state.sessions, state.settings, state.composer, state.transcript, state.activity, state.workbench]) module.startCommands()
      // Everything below can synchronously invoke external callbacks. It runs
      // only after the owner is registered and every module command host
      // is active; the outer construction transaction rolls every step back.
      services.start?.before?.()
      services.start?.after?.()
      // The startup session's history, read ahead of construction, paints
      // before any live event (an services owning the facts replays its own).
      feed.bind()
      // Cordis owns the Channel lifetime. Rebinding handles the common case;
      // this effect closes the final timer and releases the DecisionEvents
      // dispatch-topology marker when the Channel's context unloads.
      const effect = (ctx as Context & {
        effect?: (setup: () => () => void, label?: string) => void
      }).effect
      effect?.call(ctx, () => () => {
        // The context owns the complete Channel lifetime. Keep emitter and
        // IDE-link teardown in the same finally funnel.
        state.dispose()
      }, 'dsh-tui channel lifecycle')
      refreshGitBranch()
      publishRuntime(state)
      return state
    },
  }
}
