import { foldRows, MAX_ROWS } from './window.js'
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
  const windowCursor = { rows: undefined as unknown, index: 0, head: undefined as unknown }
  const activityRows = new Map<string, ChatRow>()
  return {
    store: owned.store,
    commands,
    ingress: {
      restoreSessionMetrics(metrics: Pick<TranscriptSnapshot, 'tokens' | 'responseChars' | 'activeToolCount' | 'lastUserText' | 'spinnerMode' | 'tps' | 'tpsSamples' | 'lastUsage' | 'contextSegments'>): void {
        owned.patch({ ...metrics, tpsSamples: [...metrics.tpsSamples] })
      },
      setTaskState(todos: TranscriptSnapshot['todos'], goal: TranscriptSnapshot['goal']): void { owned.patch({ todos: [...todos], goal }) },
      touch(): void { owned.update(() => {}) },
      setContextOccupancy(contextOccupancy: TranscriptSnapshot['contextOccupancy']): void { owned.patch({ contextOccupancy }) },
      setLoadedContext(loadedContext: TranscriptSnapshot['loadedContext']): void { owned.patch({ loadedContext }) },
      clearResponseActivity(): void { owned.patch({ activeToolCount: 0, responseChars: 0 }) },
      appendLocalRow(row: ChatRow): void { owned.update(draft => { draft.rows.push(row) }) },
      prependHistoryRows(rows: readonly ChatRow[]): void { owned.update(draft => { draft.rows.unshift(...rows) }) },
      restoreHistoryRows(rows: readonly ChatRow[]): void {
        const restored = new Map(rows.map(row => [row.id, row]))
        owned.update(draft => {
          for (const row of draft.rows) {
            const next = restored.get(row.id)
            if (next === undefined || (row.folded === next.folded && row.text === next.text)) continue
            row.text = next.text
            row.folded = next.folded
            if (row.tool !== undefined && next.tool !== undefined) {
              row.tool.argsFull = next.tool.argsFull
              row.tool.resultFull = next.tool.resultFull
              row.tool.errorText = next.tool.errorText
              row.tool.callView = next.tool.callView
              row.tool.resultView = next.tool.resultView
              row.tool.status = next.tool.status
            }
            markChannelReadDirty(row)
          }
          markChannelReadDirty(draft.rows)
        })
      },
      prepareEmission(fold: boolean, restorable?: (row: Readonly<ChatRow>) => boolean): void {
        owned.update(draft => { if (fold) foldRows(draft.rows, MAX_ROWS, windowCursor, restorable) })
      },
      resetConversationState(): void {
        owned.patch({
          todos: [],
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, idle: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
          mainCost: {}, costReport: undefined, lastUsage: undefined, turnUsage: undefined,
          contextSegments: { system: 0, prompt: 0, assistant: 0, thinking: 0, tools: 0 },
          activeToolCount: 0, responseChars: 0,
        })
      },
      clearLoadedContext(): void { owned.patch({ loadedContext: undefined }) },
      releaseActiveTools(): void { owned.patch({ activeToolCount: 0 }) },
      resetRows(): void {
        owned.update(draft => {
          draft.rows.length = 0
          markChannelReadDirty(draft.rows)
        })
      },
      resetSessionState(): void {
        owned.patch({
          todos: [], goal: undefined,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, idle: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
          mainCost: {}, responseChars: 0, activeToolCount: 0, lastUserText: '',
          spinnerMode: 'requesting', tps: undefined, tpsSamples: [],
          lastUsage: undefined, turnUsage: undefined, costReport: undefined,
          contextSegments: { system: 0, prompt: 0, assistant: 0, thinking: 0, tools: 0 },
        })
      },
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
