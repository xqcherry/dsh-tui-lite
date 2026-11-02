import type { ContextOccupancy } from '../../../shared/protocol/session.js'
import type { SessionCostByModel, SubagentCostEntry, TokenUsage } from '../../../shared/protocol/transcript.js'
import { estimateSessionCostSnapshotCny } from '../../transcript/index.js'

export interface StatusSummaryInput {
  readonly status: string
  readonly provider: string
  readonly model: string
  readonly cwd: string
  readonly contextWindow: number | undefined
  readonly contextOccupancy: ContextOccupancy | undefined
  readonly tokens: TokenUsage
  readonly mainCost: SessionCostByModel
  readonly subagentCost: readonly SubagentCostEntry[]
}

const formatCny = (amount: number): string => new Intl.NumberFormat('en', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 8,
}).format(amount)

function formatStatusTokens(count: number): string {
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(1))}m`
  if (count >= 1_000) return `${Number((count / 1_000).toFixed(1))}k`
  return String(count)
}

function contextLine(occupancy: ContextOccupancy | undefined, configuredWindow: number | undefined): string {
  if (occupancy === undefined) return 'Context: unavailable'

  const used = formatStatusTokens(occupancy.usedTokens)
  const window = occupancy.contextWindow ?? configuredWindow
  if (window === undefined || window <= 0) return `Context: ${used} tokens (window capacity unknown)`

  return `Context: ${used} tokens / ${formatStatusTokens(window)} tokens (${Math.round(occupancy.usedTokens / window * 100)}%)`
}

function costLine(input: StatusSummaryInput): string {
  const estimate = estimateSessionCostSnapshotCny({
    provider: input.provider,
    main: input.mainCost,
    subagents: input.subagentCost,
    fallbackTokens: { peak: input.tokens.peak, idle: input.tokens.idle },
    fallbackModel: input.model,
  })
  if (estimate === undefined) return 'Estimated session cost: unavailable (no usage recorded)'

  const unpriced = estimate.unpricedTokens > 0
    ? `${formatStatusTokens(estimate.unpricedTokens)} tokens could not be priced with official rates`
    : ''
  if (estimate.total === 0) return `Estimated session cost: unavailable${unpriced ? ` (${unpriced})` : ''}`
  return `Estimated session cost: ¥${formatCny(estimate.total)}${unpriced ? ` · ${unpriced}` : ''}`
}

/** Build the local `/status` result from the current session snapshots. */
export function formatStatusLines(input: StatusSummaryInput): string[] {
  return [
    input.status,
    `${input.provider}/${input.model}`,
    input.cwd,
    contextLine(input.contextOccupancy, input.contextWindow),
    `Tokens: input ${formatStatusTokens(input.tokens.input)} · output ${formatStatusTokens(input.tokens.output)} · cache read ${formatStatusTokens(input.tokens.cacheRead)} · cache write ${formatStatusTokens(input.tokens.cacheWrite)}`,
    costLine(input),
  ]
}
