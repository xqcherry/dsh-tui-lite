import type { SessionResetPorts } from './reset-state.js'
import { markChannelReadDirty } from '../../../shared/state/read-view.js'

export type SessionResetState = SessionResetPorts

/**
 * Reset the projection facts shared by every foreground session adoption.
 * Target-specific route, cwd, preset, loaded-context and status fields stay
 * with the caller: not every adoption has the same semantics for those.
 */
export function resetSessionProjection(
  state: SessionResetState,
  rowIds: { value: number },
  resetProjector: () => void,
  resetSubagents: () => void,
  resetJobs: () => void,
): void {
  resetProjector()
  rowIds.value = 0
  state.transcript.ingress.update(draft => { draft.rows.length = 0 })
  state.transcript.ingress.update(draft => { markChannelReadDirty(draft.rows) })
  resetSubagents()
  resetJobs()
  state.transcript.ingress.update(draft => { draft.todos = [] })
  state.composer.ingress.update(draft => { draft.pending = [] })
  state.transcript.ingress.update(draft => { draft.goal = undefined })
  state.sessions.ingress.update(draft => { draft.sessionTitle = '' })
  state.sessions.ingress.update(draft => { draft.sessionColor = '' })
  state.transcript.ingress.update(draft => { draft.tokens = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    idle: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  } })
  // 会话级费用累计与 tokens 同生命周期：换会话/换模型/rewind 一律清零后
  // 由 replay 重建（模型切换的 replay 会按 request/header 还原各请求模型）。
  state.transcript.ingress.update(draft => { draft.mainCost = {} })
  state.activity.ingress.update(draft => { draft.subagentCost = [] })
  state.transcript.ingress.update(draft => { draft.responseChars = 0 })
  state.transcript.ingress.update(draft => { draft.activeToolCount = 0 })
  state.transcript.ingress.update(draft => { draft.lastUserText = '' })
  state.sessions.ingress.update(draft => { draft.working = false })
  // The adoption path settles any in-flight compaction before it takes the
  // new session over; a row that survived it would describe the old one.
  state.sessions.ingress.update(draft => { draft.compaction = undefined })
  state.composer.ingress.update(draft => { draft.cancelPending = false })
  state.transcript.ingress.update(draft => { draft.spinnerMode = 'requesting' })
  state.transcript.ingress.update(draft => { draft.tps = undefined })
  state.transcript.ingress.update(draft => { draft.tpsSamples = [] })
  state.transcript.ingress.update(draft => { draft.lastUsage = undefined })
  // The last turn's ledger belongs to the old session just as much.
  state.transcript.ingress.update(draft => { draft.turnUsage = undefined })
  // A backend-reported cost belongs to the session that reported it.
  state.transcript.ingress.update(draft => { draft.costReport = undefined })
  state.transcript.ingress.update(draft => { draft.contextSegments = {
    system: 0,
    prompt: 0,
    assistant: 0,
    thinking: 0,
    tools: 0,
  } })
}
