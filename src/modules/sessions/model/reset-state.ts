import type { SpinnerMode } from '../../../shared/protocol/display.js'
import type { PendingMessage } from '../../../shared/protocol/composer.js'
import type { ChannelCostReport } from '../../../shared/protocol/session.js'
import type { ChannelGoal } from '../../../shared/protocol/session.js'
import type { CompactionStatus } from '../../../shared/protocol/session.js'
import type { TodoPanelItem } from '../../../shared/protocol/session.js'
import type { ChatRow } from '../../../shared/protocol/transcript.js'
import type { SessionCostByModel } from '../../../shared/protocol/transcript.js'
import type { SubagentCostEntry } from '../../../shared/protocol/transcript.js'
import type { TokenUsage } from '../../../shared/protocol/transcript.js'
import type { TurnUsageSummary } from '../../../shared/protocol/transcript.js'

/** Explicit ResetFacts capability; no access to unrelated client operations. */
export interface ResetFacts {
  rows: ChatRow[]
  todos: TodoPanelItem[]
  pending: PendingMessage[]
  goal: ChannelGoal | undefined
  sessionTitle: string
  sessionColor: string
  tokens: TokenUsage
  mainCost: SessionCostByModel
  subagentCost: readonly SubagentCostEntry[]
  responseChars: number
  activeToolCount: number
  lastUserText: string
  working: boolean
  compaction: CompactionStatus | undefined
  cancelPending: boolean
  spinnerMode: SpinnerMode
  tps: number | undefined
  tpsSamples: { tps: number; at: number }[]
  lastUsage:
    | { input: number; output: number; cacheRead: number; cacheWrite: number; at: number }
    | undefined
  turnUsage: TurnUsageSummary | undefined
  contextSegments: {
    system: number
    prompt: number
    assistant: number
    thinking: number
    tools: number
  }
  costReport: ChannelCostReport | undefined
}
