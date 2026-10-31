import type { RuntimeCommands } from '../module-runtime.js'

/**
 * The Channel installs its effectful command delegates atomically after every
 * specialist has been constructed.  Construction-time callers fail closed
 * rather than receiving a plausible no-op while the Channel is incomplete.
 */
export type ChannelActionDelegates = Pick<RuntimeCommands,
  | 'commandCompletions'
  | 'loadOlder'
  | 'resumeTo'
  | 'newSession'
  | 'switchModel'
  | 'listEfforts'
  | 'setEffort'
  | 'setDefaultEffort'
  | 'cycleMode'
  | 'runPermissionPreset'
  | 'clear'
  | 'listModels'
  | 'listProviders'
  | 'invalidateModelCompletion'
  | 'listSkills'
  | 'describeCredential'
  | 'listFileCandidates'
  | 'listFiles'
  | 'cachedSessions'
  | 'listSessions'
  | 'previewSession'
  | 'setResumeTarget'
  | 'renameSession'
  | 'deleteSession'
  | 'renameSessionTo'
  | 'compact'
  | 'cancelCompact'
  | 'runExternalCommand'
  | 'runExternalCommandOutcome'
  | 'pushLocal'
  | 'mcpStatus'
  | 'exportSession'
  | 'initWorkspace'
  | 'doctorInfo'
  | 'listSubagents'
> & {
  runLocalCommand(command: string, includeInContext: boolean): Promise<void>
}

type ChannelActionMethodName = Exclude<keyof ChannelActionDelegates, 'runLocalCommand'>
export type ChannelActionMethods = Pick<RuntimeCommands, ChannelActionMethodName>

/** The RuntimeCommands-facing half of the readiness cell is deliberately pure:
 * one typed forwarding method per public action, with no service access. */
export function createChannelActionMethods(
  getReadyActions: () => ChannelActionDelegates,
): ChannelActionMethods {
  return {
    commandCompletions: input => getReadyActions().commandCompletions(input),
    loadOlder: () => getReadyActions().loadOlder(),
    resumeTo: sessionId => getReadyActions().resumeTo(sessionId),
    newSession: () => getReadyActions().newSession(),
    switchModel: (provider, model) => getReadyActions().switchModel(provider, model),
    listEfforts: () => getReadyActions().listEfforts(),
    setEffort: id => getReadyActions().setEffort(id),
    setDefaultEffort: id => getReadyActions().setDefaultEffort(id),
    cycleMode: () => getReadyActions().cycleMode(),
    runPermissionPreset: name => getReadyActions().runPermissionPreset(name),
    clear: () => getReadyActions().clear(),
    listModels: () => getReadyActions().listModels(),
    listProviders: () => getReadyActions().listProviders(),
    invalidateModelCompletion: () => getReadyActions().invalidateModelCompletion(),
    listSkills: () => getReadyActions().listSkills(),
    describeCredential: ref => getReadyActions().describeCredential(ref),
    listFileCandidates: (query, options) => getReadyActions().listFileCandidates(query, options),
    listFiles: () => getReadyActions().listFiles(),
    cachedSessions: () => getReadyActions().cachedSessions(),
    listSessions: (onEnriched, onPartial) => getReadyActions().listSessions(onEnriched, onPartial),
    previewSession: sessionId => getReadyActions().previewSession(sessionId),
    setResumeTarget: sessionId => getReadyActions().setResumeTarget(sessionId),
    renameSession: title => getReadyActions().renameSession(title),
    deleteSession: sessionId => getReadyActions().deleteSession(sessionId),
    renameSessionTo: (sessionId, title) => getReadyActions().renameSessionTo(sessionId, title),
    compact: () => getReadyActions().compact(),
    cancelCompact: () => getReadyActions().cancelCompact(),
    runExternalCommand: (name, rawInput) => getReadyActions().runExternalCommand(name, rawInput),
    runExternalCommandOutcome: (name, rawInput, images) => getReadyActions().runExternalCommandOutcome(name, rawInput, images),
    pushLocal: (title, lines) => getReadyActions().pushLocal(title, lines),
    mcpStatus: () => getReadyActions().mcpStatus(),
    exportSession: () => getReadyActions().exportSession(),
    initWorkspace: () => getReadyActions().initWorkspace(),
    doctorInfo: () => getReadyActions().doctorInfo(),
    listSubagents: () => getReadyActions().listSubagents(),
  }
}

export function createChannelActionReadiness() {
  let delegates: ChannelActionDelegates | undefined
  return {
    install(next: ChannelActionDelegates): void {
      if (delegates !== undefined) throw new Error('dsh-tui: Channel actions are already installed')
      delegates = Object.freeze(next)
    },
    getReadyActions(): ChannelActionDelegates {
      if (delegates === undefined) throw new Error('dsh-tui: Channel actions are not installed')
      return delegates
    },
  }
}

/**
 * The explicit-unavailable half of a non-DSH composition: one delegate per
 * public action, each failing per its own contract (`false`, `null`,
 * `undefined`, an empty list or an `{ ok: false }` result) and, for an
 * action the user invoked, saying so through `unavailable(name)` (which
 * notifies `capability-unavailable-backend`). Nothing here pretends to succeed.
 *
 * Passive reads the renderer performs on its own (agent-view rows and their
 * subscription, the cached session list, workspace sub-commands, cache
 * invalidation, approval-store wiring) answer with their empty value
 * silently: they are not user actions, and a toast per render would be
 * noise. The composition overrides the generic actions (submit path, clear,
 * local rows, file queries, completions, `/new`, `/doctor`) and every action
 * whose capability the session does have.
 */
export function createUnavailableActionDelegates(
  unavailable: (name: string) => void,
  unavailableLines: (name: string) => string[],
): ChannelActionDelegates {
  const refuse = <T>(name: string, value: T): T => {
    unavailable(name)
    return value
  }
  const refuseAsync = <T>(name: string, value: T): Promise<T> => Promise.resolve(refuse(name, value))
  return {
    commandCompletions: () => [],
    runLocalCommand: () => refuseAsync('shell', undefined),
    runPermissionPreset: () => refuseAsync('permission', false),
    loadOlder: () => 0,
    resumeTo: () => refuseAsync('resume', { ok: false, reason: 'unavailable' } as const),
    newSession: () => refuseAsync('new', false),
    switchModel: () => refuseAsync('model', false),
    listEfforts: () => refuseAsync('effort', { efforts: [], defaultEffort: undefined }),
    setEffort: () => refuseAsync('effort', false),
    // Silent: the settings layer applies the configured default on every
    // boot (not a user action), and a toast per launch would be noise.
    setDefaultEffort: () => undefined,
    cycleMode: () => refuseAsync('mode', undefined),
    clear: () => { unavailable('clear') },
    listModels: () => refuseAsync('model', []),
    listProviders: () => refuseAsync('provider', []),
    invalidateModelCompletion: () => undefined,
    listSkills: () => refuseAsync('skills', undefined),
    describeCredential: () => refuseAsync('login', undefined),
    listFileCandidates: () => Promise.resolve([]),
    listFiles: () => Promise.resolve([]),
    cachedSessions: () => undefined,
    listSessions: () => refuseAsync('resume', []),
    previewSession: () => refuseAsync('resume', []),
    setResumeTarget: () => { unavailable('resume') },
    renameSession: () => { unavailable('rename') },
    deleteSession: () => refuseAsync('resume', false),
    renameSessionTo: () => refuseAsync('rename', false),
    compact: () => { unavailable('compact') },
    // Contract: a no-op when this process runs no compaction it may abort.
    cancelCompact: () => undefined,
    // Contract: `undefined` = no such registry command, so the caller sends
    // the line to the model — exactly what a backend with its own command
    // set (Claude's native slash commands) needs.
    runExternalCommand: () => Promise.resolve(undefined),
    runExternalCommandOutcome: () => Promise.resolve(undefined),
    pushLocal: () => { unavailable('pushLocal') },
    // The report lines are the explicit answer for these three reports.
    mcpStatus: () => unavailableLines('mcp'),
    exportSession: () => refuse('export', null),
    initWorkspace: () => refuse('init', null),
    doctorInfo: () => unavailableLines('doctor'),
    listSubagents: () => Promise.resolve(unavailableLines('agents')),
  }
}
