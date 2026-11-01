export type { BackgroundJobState, JobControl, JobRow } from '../../shared/protocol/jobs.js'
export type { SubagentState, SubagentControl, SubagentRow } from '../../shared/protocol/subagents.js'

export type { ActivitySnapshot, ActivityCommands, ActivityBinding } from './state-contracts.js'

export type { ActivityRuntime } from './model/module.js'
export type { ActivityAssistantStreamFrame, SubagentCostPolicy, ActivityProjectionHost, ActivityTranscriptTarget } from './model-contracts.js'
export type { ActivityView, ActivityPhase, ProjectionRegistryLike } from './model/working-activity.js'
export type { SubagentCostSnapshot } from './model/subagents.js'
export type { BackgroundJobSnapshot, KernelJobOutputEvent, KernelJobLifecycleEvent, KernelJobEvent, KernelJobChunk, KernelJobOutputRead, BackgroundJobEvents } from './model/jobs.js'
export type { SubagentProjectionDependencies, SubagentsServiceView, SubagentCatalogEntryView } from './model/subagent-projection.js'

export interface ActivitySessionIngress {
  resetSessionCost(): void
}

/** Host capabilities consumed by the activity command owner. */
export type ActivityCommandHost = import('./state-contracts.js').ActivityCommands

/** Job presentation consumes only its own reducer and snapshot publication. */
export interface ActivityJobTarget {
  readonly ingress: Pick<import('./model/module.js').ActivityRuntime['ingress'], 'batch' | 'createJobs' | 'setBackgroundJobs'>
}

/** Child projection owns scoped reducers and the child snapshot only. */
export interface ActivitySubagentTarget {
  readonly ingress: Pick<import('./model/module.js').ActivityRuntime['ingress'], 'batch' | 'createSubagents' | 'releaseSubagents' | 'setSubagentSnapshot'>
}
