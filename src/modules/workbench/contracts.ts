import type { ActivityBinding } from '../activity/contracts.js'
import type { ComposerBinding } from '../composer/contracts.js'
import type { SessionsBinding } from '../sessions/contracts.js'
import type { SettingsBinding } from '../settings/contracts.js'
import type { TranscriptBinding } from '../transcript/contracts.js'
import type { WorkbenchBinding } from './state-contracts.js'

/** Public module bindings expose immutable snapshots and owned commands only. */
export interface WorkbenchModules {
  readonly activity: ActivityBinding
  readonly composer: ComposerBinding
  readonly sessions: SessionsBinding
  readonly settings: SettingsBinding
  readonly transcript: TranscriptBinding
  readonly workbench: WorkbenchBinding
}

export type { WorkbenchSnapshot, WorkbenchCommands, WorkbenchBinding } from './state-contracts.js'

/** Host capabilities consumed by the workbench command owner. */
export type WorkbenchCommandHost = import('./state-contracts.js').WorkbenchCommands

/** Target identity and route supplied by host session adoption. */
export interface SessionAdoptionFacts {
  readonly identity: Parameters<import('../sessions/contracts.js').SessionEventIngress['adoptIdentity']>[0]
  readonly route: Parameters<import('../settings/contracts.js').SettingsSessionIngress['adoptRoute']>[0]
  readonly clearLoadedContext: boolean
}
