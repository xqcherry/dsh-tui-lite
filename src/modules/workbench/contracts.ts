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
