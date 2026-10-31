/** Test-only bridge for historical raw channel fixtures. Production receives modules. */
const fields = {
  sessions: ['status', 'sessionTitle', 'sessionColor', 'agentId', 'sessionId', 'agentBindingGeneration', 'cwd', 'displayCwd', 'gitBranch', 'working', 'compaction', 'mode', 'modeIndex', 'agentPreset'],
  settings: ['model', 'provider', 'configuredProvider', 'configuredModel', 'configuredPreset', 'contextWindow', 'reasoningEffort', 'effortLevels', 'diffLayout', 'thinkingFold', 'jobGroupFold', 'toolBackground', 'promptSessionLabel', 'expandEditor'],
  composer: ['selection', 'cancelPending', 'pending'],
  transcript: ['rows', 'costReport', 'olderHistory', 'tokens', 'mainCost', 'spinnerMode', 'responseChars', 'activeToolCount', 'turnStart', 'lastUserText', 'lastUsage', 'turnUsage', 'contextOccupancy', 'tps', 'tpsSamples', 'goal', 'todos', 'loadedContext', 'contextSegments'],
  activity: ['subagentCost', 'subagents', 'backgroundJobs'],
  workbench: ['notifications', 'commandList'],
}
const commands = {
  sessions: ['resumeTo', 'newSession', 'cachedSessions', 'listSessions', 'previewSession', 'setResumeTarget', 'renameSession', 'deleteSession', 'renameSessionTo', 'capabilities', 'cycleMode', 'permissionPresets', 'runPermissionPreset'],
  settings: ['switchModel', 'listEfforts', 'setEffort', 'setDefaultEffort', 'listModels', 'listProviders', 'invalidateModelCompletion', 'describeCredential', 'providerSetup', 'oauthProviderStatuses', 'listSkills'],
  composer: ['stageImage', 'stagedImageGeneration', 'stageComposerImage', 'hasStagedImage', 'discardStagedImage', 'stagedImage', 'stagedImageLimits', 'submit', 'steer', 'removePending', 'cancel', 'interruptAndDeliver', 'interruptAndDock', 'deliverDocked', 'swapDockedForDraft', 'commandCompletions', 'listFileCandidates', 'listFiles'],
  transcript: ['clear', 'loadOlder', 'compact', 'cancelCompact', 'exportSession', 'pushLocal'],
  activity: ['listSubagents', 'jobControl', 'subagentControl'],
  workbench: ['notify', 'runExternalCommand', 'runExternalCommandOutcome', 'mcpStatus', 'initWorkspace', 'doctorInfo'],
}
const fixtures = new WeakMap()
const prompts = new WeakMap()
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

export function fixtureModules(source) {
  if (fixtures.has(source)) return fixtures.get(source)
  const modules = {}
  for (const name of Object.keys(fields)) {
    let signature
    let snapshot
    const getSnapshot = () => {
      const data = Object.fromEntries(fields[name].map(key => [key, source[key]]))
      const next = JSON.stringify(data)
      if (snapshot === undefined || next !== signature) {
        signature = next
        snapshot = freeze(JSON.parse(next))
      }
      return snapshot
    }
    const store = Object.freeze({
      getSnapshot,
      subscribe: listener => source.subscribe?.(listener) ?? (() => {}),
    })
    const owned = Object.fromEntries(commands[name].filter(key => key in source).map(key => [key,
      typeof source[key] === 'function' ? (...args) => source[key](...args) : source[key],
    ]))
    modules[name] = Object.freeze({ store, commands: Object.freeze(owned) })
  }
  const result = Object.freeze(modules)
  fixtures.set(source, result)
  return result
}

export function composerFixture(source) {
  if (prompts.has(source)) return prompts.get(source)
  const modules = fixtureModules(source)
  const props = {
    composer: modules.composer,
    context: Object.freeze({
      sessions: modules.sessions.store,
      settings: modules.settings.store,
      workbench: modules.workbench.store,
      notify: modules.workbench.commands.notify,
      cycleMode: modules.sessions.commands.cycleMode,
    }),
  }
  prompts.set(source, props)
  return props
}
