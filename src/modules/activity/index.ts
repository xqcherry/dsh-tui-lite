/** Public activity index. */

export { JobCard } from './ui/JobCard.js'

export { JobGroupHeader } from './ui/JobGroupHeader.js'

export { SubagentMessage } from './ui/SubagentMessage.js'

export type * from './contracts.js'

export { createActivityModule } from './model/module.js'

export { BackgroundJobStore, JOBS_MAX_TRACKED, JOBS_MAX_OUTPUT_LINES, JOBS_MAX_TIMELINE } from './model/jobs.js'
export { SubagentActivityStore } from './model/subagents.js'
export { ActivityStore, ACTIVITY_PROJECTION_KEY, asActivityView, createActivityFeed, seedActivity } from './model/working-activity.js'
export { createActivitySubagentProjection } from './model/subagent-projection.js'

export { createJobPresentation } from './model/job-presentation.js'
