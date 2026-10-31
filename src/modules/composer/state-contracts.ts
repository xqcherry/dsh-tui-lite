import type { ChannelSelection } from '../../shared/protocol/composer.js'
import type { PendingMessage } from '../../shared/protocol/composer.js'
import type { CommandCompletion } from '../../shared/protocol/commands.js'
import type { FileCandidate } from '../../shared/protocol/commands.js'
import type { ComposerImageRef } from '../../shared/protocol/composer.js'
import type { ComposerSubmission } from '../../shared/protocol/composer.js'
import type { StagedImageHandle } from '../../shared/protocol/composer.js'
import type { StagedImageInput } from '../../shared/protocol/composer.js'
import type { TranscriptImage } from '../../shared/protocol/composer.js'
import type { ReadableStore } from '../../shared/state/module-store.js'

export interface ComposerSnapshot {
  readonly selection: ChannelSelection | undefined
  readonly cancelPending: boolean
  readonly pending: readonly PendingMessage[]
}

export interface ComposerCommands {
  stageImage(input: StagedImageInput): Promise<string>
  stagedImageGeneration(): number
  stageComposerImage(input: StagedImageInput, generation: number): Promise<StagedImageHandle>
  hasStagedImage(stageId: string): boolean
  discardStagedImage(stageId: string): void
  stagedImage(stageId: string): TranscriptImage | undefined
  stagedImageLimits(): {
    readonly maxImageBytes: number
    readonly maxImagesPerMessage: number
    readonly maxImageDimension: number
    readonly maxImagePixels: number
  } | undefined
  submit(text: string, images?: readonly ComposerImageRef[]): void
  steer(text: string, images?: readonly ComposerImageRef[]): void
  removePending(id: string): boolean
  cancel(): void
  interruptAndDeliver(inputs: readonly (string | ComposerSubmission)[]): number
  interruptAndDock(): number
  deliverDocked(): number
  swapDockedForDraft(id: string, draft: { text: string; images?: readonly ComposerImageRef[] }): boolean
  commandCompletions(input: string): readonly CommandCompletion[]
  listFileCandidates(query: string, options?: { signal?: AbortSignal; topK?: number }): Promise<readonly FileCandidate[]>
  listFiles(): Promise<readonly string[]>
}

export interface ComposerBinding {
  readonly store: ReadableStore<ComposerSnapshot>
  readonly commands: Readonly<ComposerCommands>
}
