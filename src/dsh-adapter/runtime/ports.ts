/** In-process public capability projections. Only the adapter sees its mutable runtime. */
import type { WorkbenchModules } from '../../modules/workbench/contracts.js'
import type { Client } from './client.js'

function select<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const view = Object.create(null) as Pick<T, K>
  for (const key of keys) {
    Object.defineProperty(view, key, {
      enumerable: true,
      get: () => source[key],
    })
  }
  return Object.freeze(view)
}

export function createWorkbenchPorts(runtime: Client): WorkbenchModules {
  return {
    composer: select(runtime, ['agentBindingGeneration', 'agentId', 'hasStagedImage', 'pending', 'stagedImageGeneration', 'discardStagedImage', 'commandCompletions', 'listFileCandidates', 'stagedImage', 'notify', 'cwd', 'submit', 'working', 'steer', 'removePending', 'deliverDocked', 'swapDockedForDraft', 'interruptAndDeliver', 'commandList', 'stagedImageLimits', 'stageComposerImage', 'cycleMode', 'interruptAndDock', 'cancel', 'sessionColor', 'mode', 'notifications', 'sessionTitle', 'promptSessionLabel', 'reasoningEffort', 'effortLevels']),
    sessions: select(runtime, ['agentId', 'sessionId', 'agentBindingGeneration', 'cwd', 'displayCwd', 'sessionTitle', 'sessionColor', 'newSession', 'resumeTo', 'listSessions', 'renameSession']),
    settings: select(runtime, ['provider', 'model', 'reasoningEffort', 'effortLevels', 'mode', 'listModels', 'switchModel', 'listEfforts', 'setEffort', 'permissionPresets', 'runPermissionPreset', 'providerSetup']),
    transcript: select(runtime, ['rows', 'olderHistory', 'loadOlder', 'compact', 'exportSession', 'clear', 'contextOccupancy', 'contextWindow', 'working', 'cancelPending', 'status', 'cancel', 'pushLocal']),
    workbench: select(runtime, ['version', 'subscribe', 'notify', 'doctorInfo', 'mcpStatus', 'runExternalCommandOutcome']),
  }
}
