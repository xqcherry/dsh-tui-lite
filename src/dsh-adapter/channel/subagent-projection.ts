import { createActivitySubagentProjection } from '../../modules/activity/index.js'
import type { ActivityRuntime, ActivityTranscriptTarget, SubagentProjectionDependencies } from '../../modules/activity/index.js'
import { subagentCostPolicy } from '../subagents.js'

export type { SubagentsServiceView, SubagentCatalogEntryView } from '../../modules/activity/index.js'

/** Only the host wiring crosses this boundary; reduction belongs to activity. */
export function createSubagentProjection(
  activity: ActivityRuntime,
  transcript: ActivityTranscriptTarget,
  deps: Omit<SubagentProjectionDependencies, 'costPolicy'>,
) {
  return createActivitySubagentProjection(activity, transcript, { ...deps, costPolicy: subagentCostPolicy })
}
