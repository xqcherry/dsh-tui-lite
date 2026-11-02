import type { LocalCommand } from '../../shared/protocol/commands.js'
import type { NotificationItem } from '../../shared/protocol/session.js'
import type { ComposerImageRef } from '../../shared/protocol/composer.js'
import type { ExternalCommandOutcome } from '../../shared/protocol/session.js'
import type { ReadableStore } from '../../shared/state/module-store.js'

export interface WorkbenchSnapshot {
  readonly backendVersion?: string
  readonly notifications: readonly NotificationItem[]
  readonly commandList: readonly LocalCommand[]
}

export interface WorkbenchCommands {
  notify(text: string, options?: { color?: NotificationItem['color']; timeoutMs?: number }): () => void
  runExternalCommand(name: string, rawInput: string, images?: readonly ComposerImageRef[]): Promise<string | undefined>
  runExternalCommandOutcome(
    name: string,
    rawInput: string,
    images?: readonly ComposerImageRef[],
  ): Promise<ExternalCommandOutcome | undefined>
  mcpStatus(): string[]
  initWorkspace(): string | null
  doctorInfo(): string[]
}

export interface WorkbenchBinding {
  readonly store: ReadableStore<WorkbenchSnapshot>
  readonly commands: Readonly<WorkbenchCommands>
}
