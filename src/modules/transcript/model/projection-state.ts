import type { SpinnerMode } from '../../../shared/protocol/display.js'
import type { ChannelCostReport } from '../../../shared/protocol/session.js'
import type { ChannelGoal } from '../../../shared/protocol/session.js'
import type { CompactionStatus } from '../../../shared/protocol/session.js'
import type { SessionCostByModel } from '../../../shared/protocol/transcript.js'
import type { TokenUsage } from '../../../shared/protocol/transcript.js'
import type { TurnUsageSummary } from '../../../shared/protocol/transcript.js'

/** Explicit ProjectionFacts capability; no access to unrelated client operations. */
export interface ProjectionFacts {
  thinkingFold: 'preview' | 'full'
  activeToolCount: number
  spinnerMode: SpinnerMode
  goal: ChannelGoal | undefined
  contextSegments: {
    system: number
    prompt: number
    assistant: number
    thinking: number
    tools: number
  }
  tokens: TokenUsage
  mainCost: SessionCostByModel
  model: string
  lastUsage:
    | { input: number; output: number; cacheRead: number; cacheWrite: number; at: number }
    | undefined
  turnUsage: TurnUsageSummary | undefined
  lastUserText: string
  responseChars: number
  tps: number | undefined
  cancelPending: boolean
  working: boolean
  compaction: CompactionStatus | undefined
  turnStart: number
  contextWindow: number | undefined
  reasoningEffort: string | undefined
  sessionTitle: string
  agentPreset: string | undefined
  sessionColor: string
  costReport: ChannelCostReport | undefined
}
