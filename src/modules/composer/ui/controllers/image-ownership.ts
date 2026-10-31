


import type { DraftImageLease } from '../../model/image-tokens.js'


import type { PromptHistoryEntry, DraftUndoEntry } from '../../model/editing.js'

import React from 'react'


import type { ComposerImageRef } from '../../../../shared/protocol/composer.js'

import type { ComposerPort as Channel } from '../../contracts.js'


interface Context {
  readonly advanceDraftRevision: () => void
  readonly draftImagesRef: React.RefObject<Map<string, string>>
  readonly clearDraftUndo: () => void
  readonly draftUndoRef: React.RefObject<DraftUndoEntry[]>
  readonly history: React.RefObject<PromptHistoryEntry[]>
  readonly historyDraft: React.RefObject<PromptHistoryEntry>
  readonly channel: Channel
  readonly draftImagesGenerationRef: React.RefObject<number>
  readonly nextImageNumberRef: React.RefObject<number>
  readonly draftRevisionRef: React.RefObject<number>
}

export function createImageOwnership(getContext: () => Context) {
const detachDraftImages = (): void => {
    const { advanceDraftRevision, draftImagesRef, clearDraftUndo } = getContext()


    advanceDraftRevision()
    draftImagesRef.current.clear()
    clearDraftUndo()

  }

const stageIdIsRetained = (stageId: string): boolean => {
    const { draftImagesRef, draftUndoRef, history, historyDraft, channel } = getContext()


    for (const current of draftImagesRef.current.values()) {
      if (current === stageId) return true
    }
    return draftUndoRef.current.some(entry => entry.images.some(image => image.stageId === stageId))
      || history.current.some(entry => entry.images.some(image => image.stageId === stageId))
      || historyDraft.current.images.some(image => image.stageId === stageId)
      || channel.pending.some(item => item.images?.some(image => image.stageId === stageId) === true)
  }

const discardUnretainedImages = (stageIds: Iterable<string>): void => {
    const { channel } = getContext()


    for (const stageId of new Set(stageIds)) {
      if (!stageIdIsRetained(stageId)) channel.discardStagedImage(stageId)
    }
  }

const discardDraftImages = (options?: { keepUndo?: boolean }): void => {
    const { advanceDraftRevision, draftImagesRef, clearDraftUndo } = getContext()


    advanceDraftRevision()
    const stageIds = [...draftImagesRef.current.values()]
    // Keep the draft stack when Ctrl+Z must be able to undo the clear.
    if (options?.keepUndo !== true) clearDraftUndo()

    draftImagesRef.current.clear()
    discardUnretainedImages(stageIds)
  }

const replaceDraftImages = (images: readonly ComposerImageRef[]): void => {
    const { draftImagesRef, channel } = getContext()


    const previous = [...draftImagesRef.current.values()]
    draftImagesRef.current.clear()
    for (const ref of images) {
      if (channel.hasStagedImage?.(ref.stageId) === true) {
        draftImagesRef.current.set(ref.token, ref.stageId)
      }
    }
    discardUnretainedImages(previous)
  }

const syncImageGeneration = (): number => {
    const { channel, draftImagesGenerationRef, draftUndoRef, nextImageNumberRef } = getContext()


    const generation = channel.stagedImageGeneration?.() ?? 0
    if (draftImagesGenerationRef.current !== generation) {
      // The channel has already cleared every old-generation capability.
      // Only detach the UI sidecar; calling discard would be redundant.
      draftUndoRef.current = []

      detachDraftImages()
      draftImagesGenerationRef.current = generation
      // Presentation numbering is session-local like the old channel-owned
      // sequence. Any stale token still visible in the retained draft is
      // skipped by bindStagedImage, so resetting cannot recreate an alias.
      nextImageNumberRef.current = 1
    }
    return generation
  }

const captureDraftImageLease = (): DraftImageLease => {
    const { draftRevisionRef } = getContext()

return ({
    generation: syncImageGeneration(),
    revision: draftRevisionRef.current,
  })
  }

const draftImageLeaseIsCurrent = (lease: DraftImageLease): boolean =>
    {
    const { draftRevisionRef } = getContext()

return syncImageGeneration() === lease.generation
    && draftRevisionRef.current === lease.revision
  }

const restoreDraftImages = (entry: PromptHistoryEntry): void => {
    const { advanceDraftRevision, clearDraftUndo } = getContext()


    syncImageGeneration()
    advanceDraftRevision()
    replaceDraftImages(entry.images)
    // A recall is not undoable (D4): the undo stack ends with the draft it replaced.
    clearDraftUndo()

  }
  return { detachDraftImages, stageIdIsRetained, discardUnretainedImages, discardDraftImages, replaceDraftImages, syncImageGeneration, captureDraftImageLease, draftImageLeaseIsCurrent, restoreDraftImages }
}
