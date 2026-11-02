import type { SpinnerMode } from '../../shared/protocol/display.js'
import type { ChannelCostReport } from '../../shared/protocol/session.js'
import type { ChannelGoal } from '../../shared/protocol/session.js'
import type { ContextOccupancy } from '../../shared/protocol/session.js'
import type { LoadedContext } from '../../shared/protocol/session.js'
import type { TodoPanelItem } from '../../shared/protocol/session.js'
import type { ChatRow } from '../../shared/protocol/transcript.js'
import type { SessionCostByModel } from '../../shared/protocol/transcript.js'
import type { TokenUsage } from '../../shared/protocol/transcript.js'
import type { TurnUsageSummary } from '../../shared/protocol/transcript.js'
import type { ReadableStore } from '../../shared/state/module-store.js'

export interface TranscriptSnapshot {
  readonly rows: readonly ChatRow[]
  readonly costReport: ChannelCostReport | undefined
  readonly olderHistory: boolean
  readonly tokens: TokenUsage
  readonly mainCost: SessionCostByModel
  readonly spinnerMode: SpinnerMode
  readonly responseChars: number
  readonly activeToolCount: number
  readonly turnStart: number
  readonly lastUserText: string
  readonly lastUsage:
    | { input: number; output: number; cacheRead: number; cacheWrite: number; at: number }
    | undefined
  readonly turnUsage: TurnUsageSummary | undefined
  readonly contextOccupancy: ContextOccupancy | undefined
  readonly tps: number | undefined
  readonly tpsSamples: readonly { tps: number; at: number }[]
  readonly goal: ChannelGoal | undefined
  readonly todos: readonly TodoPanelItem[]
  readonly loadedContext: LoadedContext | undefined
  readonly contextSegments: {
    system: number
    prompt: number
    assistant: number
    thinking: number
    tools: number
  }
}

export interface TranscriptCommands {
  clear(): void
  loadOlder(): number
  compact(): void
  cancelCompact(): void
  exportSession(): string | null
  pushLocal(title: string, lines: readonly string[], options?: { commandResult?: boolean }): void
}

export interface TranscriptBinding {
  readonly store: ReadableStore<TranscriptSnapshot>
  readonly commands: Readonly<TranscriptCommands>
}
