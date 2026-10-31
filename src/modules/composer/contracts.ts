import type { LocalCommand } from '../../shared/protocol/commands.js'
import type { SessionModeSpec } from '../../shared/protocol/display.js'
import type { PendingMessage } from '../../shared/protocol/composer.js'
import type { NotificationItem } from '../../shared/protocol/session.js'
import type { CommandCompletion } from '../../shared/protocol/commands.js'
import type { FileCandidate } from '../../shared/protocol/commands.js'
import type { ComposerImageRef } from '../../shared/protocol/composer.js'
import type { ComposerSubmission } from '../../shared/protocol/composer.js'
import type { StagedImageHandle } from '../../shared/protocol/composer.js'
import type { StagedImageInput } from '../../shared/protocol/composer.js'
import type { TranscriptImage } from '../../shared/protocol/composer.js'

/** Explicit ComposerPort capability; no access to unrelated client operations. */
export interface ComposerPort {
  readonly agentBindingGeneration: number
  readonly agentId: string
  hasStagedImage(stageId: string): boolean
  readonly pending: readonly PendingMessage[]
  stagedImageGeneration(): number
  discardStagedImage(stageId: string): void
  commandCompletions(input: string): readonly CommandCompletion[]
  listFileCandidates(query: string, options?: { signal?: AbortSignal; topK?: number }): Promise<readonly FileCandidate[]>
  stagedImage(stageId: string): TranscriptImage | undefined
  notify(text: string, options?: { color?: NotificationItem['color']; timeoutMs?: number }): () => void
  readonly cwd: string
  submit(text: string, images?: readonly ComposerImageRef[]): void
  readonly working: boolean
  steer(text: string, images?: readonly ComposerImageRef[]): void
  removePending(id: string): boolean
  deliverDocked(): number
  swapDockedForDraft(id: string, draft: { text: string; images?: readonly ComposerImageRef[] }): boolean
  interruptAndDeliver(inputs: readonly (string | ComposerSubmission)[]): number
  readonly commandList: readonly LocalCommand[]
  stagedImageLimits(): {
    readonly maxImageBytes: number
    readonly maxImagesPerMessage: number
    readonly maxImageDimension: number
    readonly maxImagePixels: number
  } | undefined
  stageComposerImage(input: StagedImageInput, generation: number): Promise<StagedImageHandle>
  cycleMode(): Promise<void>
  interruptAndDock(): number
  cancel(): void
  readonly sessionColor: string
  readonly mode: SessionModeSpec
  readonly notifications: readonly NotificationItem[]
  readonly sessionTitle: string
  readonly promptSessionLabel: boolean
  readonly reasoningEffort: string | undefined
  readonly effortLevels: readonly string[] | undefined
}

export type { InputConvergence } from './model/actions.js'

export type { ComposerActions } from './model/actions-contract.js'
