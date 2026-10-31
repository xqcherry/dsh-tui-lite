
import { readBoundedRegularFile } from '../../../../shared/platform/read-bounded-file.js'
import type { StagedImageHandle } from '../../../../shared/protocol/composer.js'


import { mediaTypeLabel } from '../../model/image-tokens.js'
import type { DraftImageLease } from '../../model/image-tokens.js'


import type { DraftUndoEntry, UndoMode } from '../../model/editing.js'

import React from 'react'


import { basename, resolve } from 'node:path'

import { t } from '../../../../shared/i18n.js'
import type { ComposerPort as Channel } from '../../contracts.js'


import { sanitizeEditableText } from '../../../../shared/platform/inputPaste.js'


import { imagePathMediaType } from '../../../../shared/platform/pastedImagePath.js'


interface Context {
  readonly valueRef: React.RefObject<string>
  readonly selectionRef: React.RefObject<{ start: number; end: number; } | null>
  readonly cursorRef: React.RefObject<number>
  readonly setInput: (next: string, cursorOffset?: number, undo?: UndoMode, snapshotBlock?: DraftUndoEntry["block"]) => void
  readonly setSelectedCommand: React.Dispatch<React.SetStateAction<number>>
  readonly setFileSelected: React.Dispatch<React.SetStateAction<number>>
  readonly draftImageLeaseIsCurrent: (lease: DraftImageLease) => boolean
  readonly channel: Channel
  readonly draftImagesRef: React.RefObject<Map<string, string>>
  readonly imageStageChainRef: React.RefObject<Promise<void>>
  readonly nextImageNumberRef: React.RefObject<number>
}

export function createAttachments(getContext: () => Context) {
const insertClipboardAtCaret = (text: string): { next: string; at: number } => {
    const { valueRef, selectionRef, cursorRef, setInput, setSelectedCommand, setFileSelected } = getContext()


    text = sanitizeEditableText(text)
    const current = valueRef.current
    const sel = selectionRef.current
    const position = sel ? sel.start : cursorRef.current
    const next = sel
      ? current.slice(0, sel.start) + text + current.slice(sel.end)
      : current.slice(0, position) + text + current.slice(position)
    // A paste is ONE undo step however many characters it carries.
    setInput(next, position + text.length, 'step')
    setSelectedCommand(0)
    setFileSelected(0)
    return { next, at: position }
  }

const stageImagePath = async (path: string, lease: DraftImageLease): Promise<StagedImageHandle> => {
    const { draftImageLeaseIsCurrent, channel, draftImagesRef } = getContext()


    if (!draftImageLeaseIsCurrent(lease)) {
      throw new Error('the draft changed while the image was being staged')
    }
    const limits = channel.stagedImageLimits?.()
    if (limits === undefined) throw new Error('image attachments are unavailable in this profile')
    // One-image paste operations are serialized, so this is the cumulative
    // draft count (not merely the current Finder batch). Refuse before the
    // descriptor read/save and never let the channel's 128-capability cache
    // become an accidental per-command batch size.
    if (draftImagesRef.current.size >= limits.maxImagesPerMessage) {
      throw new Error('image count exceeds this profile\'s per-message limit')
    }
    const data = await readBoundedRegularFile(path, limits.maxImageBytes)
    if (!draftImageLeaseIsCurrent(lease)) {
      throw new Error('the draft changed while the image was being staged')
    }
    return channel.stageComposerImage({
      data,
      // Callers gate on imagePathMediaType; the assertion is unreachable.
      mediaType: imagePathMediaType(path) ?? 'image/png',
      name: basename(path),
      // The preview card's path row: the file that was read, as an
      // absolute path (a clipboard bitmap shows its temp export).
      path: resolve(path),
    }, lease.generation)
  }

const enqueueImageWork = <T,>(work: () => Promise<T>): Promise<T> => {
    const { imageStageChainRef } = getContext()


    const queued = imageStageChainRef.current.then(work, work)
    imageStageChainRef.current = queued.then(() => undefined, () => undefined)
    return queued
  }

const stagedImageNotice = (token: string, handle: StagedImageHandle): string => {


    const adjustment = handle.adjustment
    if (adjustment === undefined) return t('input-image-pasted', { token })
    const details: string[] = []
    if (adjustment.resized) {
      details.push(t('input-image-detail-resized', {
        width: adjustment.width,
        height: adjustment.height,
      }))
    }
    if (adjustment.mediaType !== adjustment.sourceMediaType) {
      const from = mediaTypeLabel(adjustment.sourceMediaType)
      const to = mediaTypeLabel(adjustment.mediaType)
      details.push(adjustment.flattened
        ? t('input-image-detail-converted-flattened', { from, to })
        : t('input-image-detail-converted', { from, to }))
    }
    // An adjustment always describes a resize or a conversion; anything else
    // keeps the plain notice rather than an empty parenthetical. ' · ' joins
    // the clauses in both shipped languages.
    if (details.length === 0) return t('input-image-pasted', { token })
    return t('input-image-pasted-adjusted', { token, detail: details.join(' · ') })
  }

const discardStagedHandles = (handles: readonly StagedImageHandle[]): void => {
    const { channel } = getContext()


    for (const stageId of new Set(handles.map(handle => handle.stageId))) {
      channel.discardStagedImage(stageId)
    }
  }

const bindStagedImage = (handle: StagedImageHandle, lease: DraftImageLease): string => {
    const { draftImageLeaseIsCurrent, channel, nextImageNumberRef, valueRef, draftImagesRef } = getContext()


    if (!draftImageLeaseIsCurrent(lease)) {
      // The save completed, but its initiating draft was already submitted,
      // replaced, or unmounted. Reclaim this otherwise-unreachable channel
      // capability instead of waiting for the session FIFO to evict it.
      channel.discardStagedImage(handle.stageId)
      throw new Error('the draft changed while the image was being staged')
    }
    if (channel.hasStagedImage?.(handle.stageId) !== true) {
      throw new Error('the draft changed while the image was being staged')
    }
    let token = `[Image #${nextImageNumberRef.current}]`
    while (valueRef.current.includes(token) || draftImagesRef.current.has(token)) {
      nextImageNumberRef.current += 1
      token = `[Image #${nextImageNumberRef.current}]`
    }
    nextImageNumberRef.current += 1
    draftImagesRef.current.set(token, handle.stageId)
    return token
  }
  return { insertClipboardAtCaret, stageImagePath, enqueueImageWork, stagedImageNotice, discardStagedHandles, bindStagedImage }
}
