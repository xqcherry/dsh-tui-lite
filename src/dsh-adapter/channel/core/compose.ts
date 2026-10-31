/** Client runtime assembly for dsh: acquire, configure host services, then start. */
import type { Context } from '@deepseek-ai/cordis'
import { LOCAL_COMMANDS } from '../../../shared/commands.js'
import type { AgentCapabilities } from '../../../shared/protocol/agent-capabilities.js'
import { t } from '../../../shared/i18n.js'
import { createInputActions, type InputConvergence } from '../../../modules/composer/index.js'
import { registerChannelOwner, type ChannelOwner } from '../../../shared/lifecycle/owner.js'
import { DEFAULT_SESSION_MODES } from '../../../modules/sessions/index.js'
import { createInitialChannelView } from '../../runtime/initial-state.js'
import { createChannelNotifications } from '../../../modules/workbench/index.js'
import { markChannelReadDirty } from '../../../shared/state/read-view.js'
import type { DshSession as AgentSession } from '../../backend/session.js'
import { resolveContextOccupancy } from '../../context-occupancy.js'
import { IdeChannel, ideLockDir, type SelectionSnapshot } from '../../ide-channel.js'
import { createChannelActionMethods, createChannelActionReadiness, type ChannelActionDelegates } from '../action-readiness.js'
import { createChannelBinding, type ChannelBinding } from '../binding.js'
import { channelCommands } from '../commands.js'
import { createComposerImages } from '../composer-images.js'
import { createContextBookkeeping } from '../context-bookkeeping.js'
import { createChannelEmitter } from '../emitter.js'
import { createSelectionAttachments } from '../ide-selection.js'
import { createInputDelivery } from '../input-delivery.js'
import { unavailablePermissionPresetSnapshot } from '../permissions.js'
import { createSettingsHosts } from '../settings-host.js'
import type { ChannelLaunchOptions } from '../state.js'
import type { ChannelState } from '../types.js'
import { installChannelActions } from './actions.js'
import { createBindingFeed, type BindingFeedHooks } from './binding-feed.js'
import { createCoreFiles, NO_COMPLETION_CATALOG, type CompletionCatalog } from './files.js'
import { createGitBranchRefresher } from './host.js'
import { createCoreLocalActions } from './local-actions.js'
import { createCoreReports } from './reports.js'
import { createSessionSwitch, type NewSessionOpener } from './session-switch.js'

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
  delegates?: Partial<ChannelActionDelegates>
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
  const binding: ChannelBinding = createChannelBinding(initialSession, owner)
  // Release the session and its subscriptions when this runtime ends.

  let services: ChannelServices = {}
  let started = false

  const emitter = createChannelEmitter(() => state, () => services.flushDeferred?.() ?? false, {
    // Folding drops a row's full text on the promise that `loadOlder`
    // restores it; without a history slicer every row stays whole. A
    // session's durable transcript restores only rows with a stable anchor.
    fold: () => services.loadOlder !== undefined,
    restorable: row => services.loadOlder !== undefined,
  })
  // The emitter exists before the complete state surface. Put it in the
  // construction rollback funnel immediately; normal release remains
  // idempotent through the same disposer.
  owner.own(() => emitter.dispose())
  const notify: ChannelState['notify'] = (...args) => {
    if (!owner.current()) return () => undefined
    return channelCommands(state).notify(...args)
  }
  /** The explicit failure every unbacked action reports. */
  const unavailable = (name: string): void => {
    notify(t('capability-unavailable-backend', { name }), { color: 'warning', timeoutMs: 4000 })
  }
  const unavailableLines = (name: string): string[] => [t('capability-unavailable-backend', { name })]
  /** "Load earlier" through the session's durable transcript: restore the
   *  folded rows first, then prepend the next older slice. */
  const bookkeeping = createContextBookkeeping(
    () => state,
    (text, notifyOptions) => notify(text, notifyOptions),
    percent => t('context-low-warning', { percent }),
    CONTEXT_WARNING_BUFFER_TOKENS,
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
    state.selection = currentSelection
    state.emit()
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
    state.selection = undefined
    state.emit()
    void ideChannel.rebind(state.cwd).catch(() => {})
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
  const composer = createComposerImages(ctx, owner, { generation: () => state.agentBindingGeneration })
  const files = createCoreFiles(ctx, {
    owner,
    binding,
    state: () => state,
    // Read late: the session controls are built after the files.
  })
  const inputDelivery = createInputDelivery(ctx, owner, binding, () => state,
    (...args) => notify(...args), trackPending, untrackPending, composer,
    () => currentSelection, (messageId, info) => selectionAttachments.remember(messageId, info),
    )
  const { dispatchUserText, clearStagedImages } = inputDelivery
  /** Monotonic token: only the latest `interruptAndDeliver` re-queues, so a
   *  second interrupt while the abort settles cannot double-deliver. */
  const inputConvergence: InputConvergence = { interruptSeq: 0, cancelInFlight: false, cancelCause: undefined }
  /**
   * Monotonic counter for parent-mediated message intents. The intentId
   * names the local submission only. It is never a durable message id, and
   * the parent's own SendMessage call (whenever the model makes it) is
   * matched by its call id, not by this.
   */
  const actionReadiness = createChannelActionReadiness()
  const getReadyActions = (): ChannelActionDelegates => {
    owner.assertActive()
    return actionReadiness.getReadyActions()
  }
  const actionMethods = createChannelActionMethods(getReadyActions)

  const contextPressure = options.contextPressure

  const state: ChannelState = {
    ...createInputActions(() => state, () => binding.session, owner, inputConvergence,
      composer,
      (text, placement, images) => dispatchUserText(text, placement, images),
      (command, includeInContext) => getReadyActions().runLocalCommand(command, includeInContext),
      sessionId => { services.touchSession?.(sessionId) }),
    subscribe: emitter.subscribe,
    emit: emitter.emit,
    emitStream: emitter.emitStream,
    ...createSettingsHosts(ctx, owner.assertActive),
    ...createInitialChannelView(options, {
      agentId: initialSession.sessionId,
      sessionId: initialSession.sessionId,
      // The unmarked base mode: backend-native modes are a capability.
      mode: DEFAULT_SESSION_MODES[0]!,
      cwdDescription: options.cwd,
    }),
    /**
     * Context occupancy is derived on read, not stored: the cached host
     * projection value (a map lookup) combined with this channel's own
     * fallback sample and capacity. An accessor avoids republishing it from
     * every site that can move the window or the sample (replay, resume,
     * model switch, reset).
     */
    get contextOccupancy() {
      return resolveContextOccupancy(
        contextPressure?.read(state.sessionId),
        state.lastUsage,
        state.contextWindow,
      )
    },
    commandList: LOCAL_COMMANDS,
    capabilities: () => services.agentCapabilities?.() ?? { compact: { route: 'none', reasonKey: 'capability-reason-no-compaction' }, plan: { route: 'none', reasonKey: 'capability-reason-no-plan-command' }, compaction: false, pruner: false, questionTool: false, skills: false },
    costReport: undefined,
    get olderHistory(): boolean {
      return false
    },
    ...actionMethods,
    subagentControl: { interrupt: () => false },
    jobControl: { kill: () => false, watchOutput: () => () => undefined },
    stagedImageGeneration: composer.stagedImageGeneration,
    stageImage: composer.stageImage,
    stageComposerImage: composer.stageComposerImage,
    hasStagedImage: composer.hasStagedImage,
    discardStagedImage: composer.discardStagedImage,
    stagedImage: composer.stagedImage,
    stagedImageLimits: composer.stagedImageLimits,
    notify: createChannelNotifications(() => state, owner),
    permissionPresets: () => unavailablePermissionPresetSnapshot(),
    releaseContributions() {
      // Owner cleanup is exhaustive, but it can report an external cleanup
      // failure. The emitter and the IDE loopback link live outside the owner
      // and must still stop whichever earlier step throws; a plain trailing
      // ideChannel.stop() would be skipped when owner.dispose() throws and
      // leak the socket.
      try {
        owner.dispose()
      } finally {
        try { emitter.dispose() } finally { ideChannel.stop() }
      }
    },
  }

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
      if (owner.current()) state.emit()
    }))
  }

  const feed = createBindingFeed(ctx, {
    owner,
    binding,
    state,
    inputConvergence,
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
    state.rows.length = 0
    markChannelReadDirty(state.rows)
    rowIds.value = 0
    feed.resetProjection()
    services.dropRows?.()
    state.todos = []
    state.sessionTitle = ''
    state.tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, idle: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
    state.mainCost = {}
    state.subagentCost = []
    state.costReport = undefined
    state.lastUsage = undefined
    state.turnUsage = undefined
    state.contextSegments = { system: 0, prompt: 0, assistant: 0, thinking: 0, tools: 0 }
    state.activeToolCount = 0
    state.responseChars = 0
    state.compaction = undefined
    resetContextWarning()
    // The history before the reset is another conversation's: "load
    // earlier" never brings it back above this view.
    const key = event.trigger === 'clear' ? 'conversation-reset-clear'
      : event.trigger === 'plan_mode_exit' ? 'conversation-reset-plan'
        : event.trigger === 'fresh_session' ? 'conversation-reset-fresh'
          : 'conversation-reset'
    state.rows.push({ id: rowIds.value++, kind: 'notice', text: t(key) })
    state.emit()
  }

  /** `!!` commands on their way to the session (`/new` waits them out). */
  const shellInputs = { started: 0, inFlight: 0 }
  const sessionSwitch = createSessionSwitch(ctx, {
    owner,
    binding,
    state: () => state,
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
    state,
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
  const reports = createCoreReports({ owner, binding, state: () => state })
  const refreshGitBranch = createGitBranchRefresher(ctx, {
    owner,
    state,
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
    inputConvergence,
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
        delegates: { ...services.delegates, ...next.delegates },
      }
    },
    /** Install the actions, start the runtime, bind the session. */
    start(): ChannelState {
      if (started) throw new Error('dsh-tui: Channel already started')
      started = true
      const core: Partial<ChannelActionDelegates> = {
        commandCompletions: files.commandCompletions(services.completions ?? NO_COMPLETION_CATALOG),
        runLocalCommand: local.runLocalCommand,
        loadOlder: local.loadOlder,
        clear: local.clear,
        pushLocal: local.pushLocal,
        listFileCandidates: files.listFileCandidates,
        listFiles: files.listFiles,
        doctorInfo: reports.doctorInfo,
        exportSession: reports.exportSession,
        newSession: () => sessionSwitch.newSession(),
      }
      installChannelActions(actionReadiness, {
        unavailable,
        unavailableLines,
        core,
        extension: services.delegates,
      })
      // Everything below can synchronously invoke external callbacks. It runs
      // only after the owner is registered and the complete delegate surface
      // is installed; the outer construction transaction rolls every step back.
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
        state.releaseContributions()
      }, 'dsh-tui channel lifecycle')
      refreshGitBranch()
      state.emit()
      return state
    },
  }
}
