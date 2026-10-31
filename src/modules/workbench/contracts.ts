import type { NotificationItem } from '../../shared/protocol/session.js'
import type { ComposerImageRef } from '../../shared/protocol/composer.js'
import type { ExternalCommandOutcome } from '../../shared/protocol/session.js'

/** Explicit WorkbenchPort capability; no access to unrelated client operations. */
export interface WorkbenchPort {
  readonly version: number
  subscribe: (listener: () => void) => () => void
  notify(text: string, options?: { color?: NotificationItem['color']; timeoutMs?: number }): () => void
  doctorInfo(): string[]
  mcpStatus(): string[]
  runExternalCommandOutcome(
    name: string,
    rawInput: string,
    images?: readonly ComposerImageRef[],
  ): Promise<ExternalCommandOutcome | undefined>
}

import type { ComposerPort } from '../composer/contracts.js'
import type { SessionsPort } from '../sessions/contracts.js'
import type { SettingsPort } from '../settings/contracts.js'
import type { TranscriptPort } from '../transcript/contracts.js'

/** The workbench composes explicit feature capabilities, never a writable client. */
export interface WorkbenchModules {
  readonly composer: ComposerPort
  readonly sessions: SessionsPort
  readonly settings: SettingsPort
  readonly transcript: TranscriptPort
  readonly workbench: WorkbenchPort
}
