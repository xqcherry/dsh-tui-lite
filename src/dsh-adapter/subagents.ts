import { SubagentActivityStore as ActivityReducer } from '../modules/activity/index.js'
import { addUsageToCostBuckets, cloneCostBuckets, emptyCostBuckets, isDeepSeekOfficialProvider, isPeakHour, priceForModel } from '../modules/transcript/index.js'
import type { SubagentCostPolicy } from '../modules/activity/index.js'

export type { SubagentOutputKind, SubagentOutputLine, SubagentState, SubagentStatus, SubagentTokenUsage, SubagentToolCall } from '../shared/protocol/subagents.js'
export type { SubagentCostEntry } from '../shared/protocol/transcript.js'
export type { SubagentCostSnapshot } from '../modules/activity/index.js'

/** Host composition supplies the pricing policy; the activity owner holds reducers. */
export const subagentCostPolicy: SubagentCostPolicy = {
  empty: emptyCostBuckets,
  clone: cloneCostBuckets,
  add: addUsageToCostBuckets,
  isPeakHour,
  isPriced: (provider, model) => isDeepSeekOfficialProvider(provider) && priceForModel(model) !== undefined,
}

/** Compatibility facade for integrations constructing a standalone reducer. */
export class SubagentActivityStore extends ActivityReducer {
  constructor() { super(subagentCostPolicy) }
}
