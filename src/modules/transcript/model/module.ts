import { createModuleStore, type Publication, type MutableSnapshot } from '../../../shared/state/module-store.js'
import type { TranscriptSnapshot, TranscriptCommands } from '../state-contracts.js'
import { createChannelProjection, type ChannelProjectionDeps } from './projection.js'
import type { ProjectionHost } from './projection-state.js'
import type { ChatRow } from '../../../shared/protocol/transcript.js'
import { markChannelReadDirty } from '../../../shared/state/read-view.js'
import type { ModuleLaunch } from '../../../shared/protocol/module-launch.js'

/** This module is the sole owner of these fields. Writers never reach the UI. */
export function createTranscriptModule(launch: ModuleLaunch, commands: TranscriptCommands, publication: Publication, rowIds = { value: 0 }) {
  const { options, input } = launch
  const owned = createModuleStore<MutableSnapshot<TranscriptSnapshot>>({
    rows: [],
    costReport: undefined,
    olderHistory: false,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, idle: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    mainCost: {},
    spinnerMode: 'requesting',
    responseChars: 0,
    activeToolCount: 0,
    turnStart: 0,
    lastUserText: '',
    lastUsage: undefined,
    turnUsage: undefined,
    contextOccupancy: undefined,
    tps: undefined,
    tpsSamples: [],
    goal: undefined,
    todos: [],
    loadedContext: undefined,
    contextSegments: { system: 0, prompt: 0, assistant: 0, thinking: 0, tools: 0 },
  }, publication, { trackedRows: true })
  const activityRows = new Map<string, ChatRow>()
  return {
    store: owned.store,
    commands,
    ingress: {
      patch: owned.patch, update: owned.update, read: owned.read,
      createProjection(host: ProjectionHost, deps: ChannelProjectionDeps) {
        let reducer!: ReturnType<typeof createChannelProjection>
        owned.update(draft => { reducer = createChannelProjection(draft, host, deps) })
        const run = <Result>(work: () => Result): Result => {
          let result!: Result
          publication.batch(() => { owned.update(() => { result = work() }) })
          return result
        }
        return {
          apply: (...args: Parameters<typeof reducer.apply>) => run(() => reducer.apply(...args)),
          reset: () => run(() => reducer.reset()),
          settleStreaming: () => run(() => reducer.settleStreaming()),
          updateSpinnerMode: () => run(() => reducer.updateSpinnerMode()),
        }
      },
      upsertActivityRow(key: string, value: Pick<ChatRow, 'kind' | 'text' | 'job' | 'subagent'>): void {
        owned.update(draft => {
          let row = activityRows.get(key)
          if (row === undefined) {
            row = { id: rowIds.value++, ...value }
            activityRows.set(key, row)
            draft.rows.push(row)
          } else Object.assign(row, value)
          markChannelReadDirty(row)
          markChannelReadDirty(draft.rows)
        })
      },
      resetActivityRows(kind: 'job' | 'subagent'): void {
        for (const key of activityRows.keys()) if (key.startsWith(`${kind}:`)) activityRows.delete(key)
      },
    },
    dispose: owned.dispose,
  }
}
