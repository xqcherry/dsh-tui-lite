import type { ChatRow, SessionCostByModel, SubagentCostEntry, TokenUsage, TurnUsageSummary } from '../../../shared/protocol/transcript.js'
import type { PendingMessage } from '../../../shared/protocol/composer.js'
import type { ChannelGoal, ChannelCostReport, CompactionStatus, TodoPanelItem } from '../../../shared/protocol/session.js'
import type { SpinnerMode } from '../../../shared/protocol/display.js'
import type { MutableSnapshot } from '../../../shared/state/module-store.js'

type ResetPort<Snapshot extends object> = {
  readonly ingress: { update(work: (draft: MutableSnapshot<Snapshot>) => void): void }
}
/** Session adoption resets only these facts across the participating owners. */
export interface SessionResetPorts {
  readonly sessions: ResetPort<{ sessionTitle: string; sessionColor: string; working: boolean; compaction: CompactionStatus | undefined }>
  readonly composer: ResetPort<{ pending: readonly PendingMessage[]; cancelPending: boolean }>
  readonly transcript: ResetPort<{
    rows: readonly ChatRow[]
    todos: readonly TodoPanelItem[]
    goal: ChannelGoal | undefined
    tokens: TokenUsage
    mainCost: SessionCostByModel
    responseChars: number
    activeToolCount: number
    lastUserText: string
    spinnerMode: SpinnerMode
    tps: number | undefined
    tpsSamples: readonly { tps: number; at: number }[]
    lastUsage: { input: number; output: number; cacheRead: number; cacheWrite: number; at: number } | undefined
    turnUsage: TurnUsageSummary | undefined
    costReport: ChannelCostReport | undefined
    contextSegments: { system: number; prompt: number; assistant: number; thinking: number; tools: number }
  }>
  readonly activity: ResetPort<{ subagentCost: readonly SubagentCostEntry[] }>
}
