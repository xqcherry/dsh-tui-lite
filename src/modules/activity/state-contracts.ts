import type { BackgroundJobState } from '../../shared/protocol/jobs.js'
import type { JobControl } from '../../shared/protocol/jobs.js'
import type { SubagentControl } from '../../shared/protocol/subagents.js'
import type { SubagentState } from '../../shared/protocol/subagents.js'
import type { SubagentCostEntry } from '../../shared/protocol/transcript.js'
import type { ReadableStore } from '../../shared/state/module-store.js'

export interface ActivitySnapshot {
  readonly subagentCost: readonly SubagentCostEntry[]
  readonly subagents: readonly SubagentState[]
  readonly backgroundJobs: readonly BackgroundJobState[]
}

export interface ActivityCommands {
  listSubagents(): Promise<string[]>
  jobControl: JobControl
  subagentControl: SubagentControl
}

export interface ActivityBinding {
  readonly store: ReadableStore<ActivitySnapshot>
  readonly commands: Readonly<ActivityCommands>
}
