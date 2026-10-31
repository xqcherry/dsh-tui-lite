import { parseCommandName, resolveLocalCommandPath } from '../../../../shared/commands.js'
import type { ComposerSubmission } from '../../../../shared/protocol/composer.js'


import type { DraftImageLease } from '../../model/image-tokens.js'
import type { CommandCompletion } from '../../../../shared/protocol/commands.js'

import type { DraftUndoEntry, UndoMode } from '../../model/editing.js'

import React from 'react'


import type { ComposerImageRef } from '../../../../shared/protocol/composer.js'
import { t } from '../../../../shared/i18n.js'
import type { ComposerPort as Channel } from '../../contracts.js'


import { type FileCandidate } from '../../../../shared/platform/file-suggestions.js'


interface Context {
  readonly syncImageGeneration: () => number
  readonly detachDraftImages: () => void
  readonly setInput: (next: string, cursorOffset?: number, undo?: UndoMode, snapshotBlock?: DraftUndoEntry["block"]) => void
  readonly setSelectedCommand: React.Dispatch<React.SetStateAction<number>>
  readonly setFileSelected: React.Dispatch<React.SetStateAction<number>>
  readonly channel: Channel
  readonly beforeSubmit: (() => boolean) | undefined
  readonly imageRefsFor: (text: string) => ComposerImageRef[]
  readonly rememberHistory: (text: string, images: readonly ComposerImageRef[]) => void
  readonly setDockSelected: (index: number | null) => void
  readonly value: string
  readonly draftRevisionRef: React.RefObject<number>
  readonly inputEditSequenceRef: React.RefObject<number>
  readonly pendingCommandRef: React.RefObject<{ readonly token: symbol; readonly generation: number; readonly revision: number; readonly editSequence: number; } | null>
  readonly captureDraftImageLease: () => DraftImageLease
  readonly valueRef: React.RefObject<string>
  readonly onRunCommand: (name: string, rawInput: string, images: readonly ComposerImageRef[]) => boolean | Promise<boolean>
  readonly warnStaleImageTokens: (text: string, images: readonly ComposerImageRef[]) => void
  readonly draftImageLeaseIsCurrent: (lease: DraftImageLease) => boolean
  readonly lastEnterAtRef: React.RefObject<number>
  readonly dockSelectedRef: React.RefObject<number | null>
  readonly dockCount: number
  readonly editDocked: (index: number) => void
  readonly overlayOpen: boolean
  readonly suggestions: readonly CommandCompletion[]
  readonly selectedCommand: number
  readonly fileOverlayOpen: boolean
  readonly fileMatches: readonly FileCandidate[]
  readonly fileSelected: number
  readonly acceptFile: (candidate: FileCandidate) => void
}

export function createSubmission(getContext: () => Context) {
const clearDeliveredDraft = (): void => {
    const { syncImageGeneration, detachDraftImages, setInput, setSelectedCommand, setFileSelected } = getContext()


    syncImageGeneration()
    // Delivery captured the opaque refs and history retains them; only the
    // editable-draft binding is ending here. `reset` ends the draft's undo
    // history: a submitted message must not come back with Ctrl+Z.
    detachDraftImages()
    setInput('', 0, 'reset')
    setSelectedCommand(0)
    setFileSelected(0)
  }

const sameImageRefs = (
    left: readonly ComposerImageRef[],
    right: readonly ComposerImageRef[],
  ): boolean => {

return left.length === right.length && left.every((image, index) =>
    image.token === right[index]?.token && image.stageId === right[index]?.stageId)
  }

const shellImagesUnsupported = (
    text: string,
    images: readonly ComposerImageRef[],
  ): boolean => {
    const { channel } = getContext()


    if (images.length === 0 || !text.startsWith('!')) return false
    channel.notify(t('shell-images-unsupported'), { color: 'warning', timeoutMs: 4000 })
    return true
  }

const submitText = (text: string, notice?: string) => {
    const { beforeSubmit, imageRefsFor, rememberHistory, channel } = getContext()


    if (beforeSubmit?.() === false) return
    const trimmed = text.trim()
    if (!trimmed) return
    const images = imageRefsFor(trimmed)
    if (shellImagesUnsupported(trimmed, images)) return
    rememberHistory(trimmed, images)
    clearDeliveredDraft()
    channel.submit(trimmed, images)
    if (notice) {
      channel.notify(notice, { timeoutMs: 2500 })
    } else if (channel.working) {
      // While the model is streaming, the message joins the DSH inbox and is
      // processed after the current turn — say so, or it looks "lost".
      channel.notify(t('input-sent-after-turn'), { timeoutMs: 2500 })
    }
  }

const steerSend = (text: string) => {
    const { beforeSubmit, imageRefsFor, rememberHistory, channel } = getContext()


    if (beforeSubmit?.() === false) return
    const trimmed = text.trim()
    if (!trimmed) return
    const images = imageRefsFor(trimmed)
    rememberHistory(trimmed, images)
    clearDeliveredDraft()
    channel.steer(trimmed, images)
    channel.notify(t('input-interrupted-next'), { timeoutMs: 2500 })
  }

const queueSend = (text: string) => {
    const { beforeSubmit, imageRefsFor, rememberHistory, channel } = getContext()


    if (beforeSubmit?.() === false) return
    const trimmed = text.trim()
    if (!trimmed) return
    const images = imageRefsFor(trimmed)
    if (shellImagesUnsupported(trimmed, images)) return
    rememberHistory(trimmed, images)
    clearDeliveredDraft()
    channel.submit(trimmed, images)
    channel.notify(t('input-queued-after-turn'), { timeoutMs: 2500 })
  }

const sendDocked = (): void => {
    const { beforeSubmit, channel, setDockSelected } = getContext()


    if (beforeSubmit?.() === false) return
    const sent = channel.deliverDocked()
    if (sent > 0) channel.notify(t('input-dock-sent', { n: sent }), { timeoutMs: 2500 })
    setDockSelected(null)
  }

const interruptSend = () => {
    const { beforeSubmit, value, channel, imageRefsFor, rememberHistory } = getContext()


    if (beforeSubmit?.() === false) return
    const trimmed = value.trim()
    if (!trimmed) {
      channel.notify(t('input-empty'), { color: 'warning' })
      return
    }
    // Abort the running turn and deliver: previously queued pending
    // messages first (FIFO), then the current input — all processed
    // immediately once the abort settles. Docked rows are NOT listed here:
    // the channel's interruptAndDeliver takes the dock itself first (same
    // FIFO order), so including them would send each docked text twice.
    const images = imageRefsFor(trimmed)
    const queued: ComposerSubmission[] = [
      ...channel.pending.filter(item => item.docked !== true).map(item => ({ text: item.text, images: item.images ?? [] })),
      { text: value, images },
    ]
    const count = channel.interruptAndDeliver(queued)
    if (count === 0) return
    rememberHistory(trimmed, images)
    clearDeliveredDraft()
    channel.notify(t('input-interrupt-immediate'), { timeoutMs: 2500 })
  }

const tryRunCommand = (text: string): boolean => {
    const { channel, syncImageGeneration, draftRevisionRef, inputEditSequenceRef, pendingCommandRef, imageRefsFor, beforeSubmit, captureDraftImageLease, valueRef, onRunCommand, warnStaleImageTokens, rememberHistory, draftImageLeaseIsCurrent } = getContext()


    if (!text.startsWith('/')) return false
    const parsed = parseCommandName(text)
    if (parsed === undefined) return false
    const command = channel.commandList.find(entry => entry.name === parsed.name)
    if (command === undefined) return false
    const generation = syncImageGeneration()
    const revision = draftRevisionRef.current
    const editSequence = inputEditSequenceRef.current
    if (
      pendingCommandRef.current?.generation === generation
      && pendingCommandRef.current.revision === revision
      && pendingCommandRef.current.editSequence === editSequence
    ) {
      channel.notify(t('command-running'), { color: 'warning', timeoutMs: 2500 })
      return true
    }
    if (pendingCommandRef.current !== null) pendingCommandRef.current = null
    const images = imageRefsFor(text)
    // Commands are an explicit non-model route. Unless their registry
    // descriptor opted into composer images, refuse before dispatch and keep
    // the exact draft/capabilities so the user can edit or send them normally.
    // Completion-only filesystem skills still fall through to the model.
    const modelRoutedSkill = command?.skill === true && command.external !== true
    if (command.skill === true && beforeSubmit?.() === false) return true
    if (modelRoutedSkill) return false
    if (images.length > 0 && !modelRoutedSkill && command?.acceptsImages !== true) {
      channel.notify(t('command-images-unsupported', { name: parsed.name }), {
        color: 'warning',
        timeoutMs: 4000,
      })
      return true
    }
    const lease = captureDraftImageLease()
    const draftText = valueRef.current
    const draftImages = imageRefsFor(draftText)
    const handled = onRunCommand(parsed.name, parsed.rawInput, images)
    if (handled === true) {
      // A local command consumed the line inside the screen.
      warnStaleImageTokens(text, images)
      rememberHistory(text.trim(), images)
      clearDeliveredDraft()
    } else if (handled !== false) {
      // Registry commands settle asynchronously. Keep the exact draft and
      // capabilities in place until admission succeeds; a handler/admission
      // error deliberately leaves them editable. A late success may clear
      // only the snapshot it actually submitted, never text/images typed
      // while the command was running or a replacement session's draft.
      const attempt = { token: Symbol('command-attempt'), generation, revision, editSequence }
      pendingCommandRef.current = attempt
      void handled.then((consume) => {
        if (
          !consume
          || !draftImageLeaseIsCurrent(lease)
          || inputEditSequenceRef.current !== editSequence
        ) return
        rememberHistory(text.trim(), images)
        const currentText = valueRef.current
        const currentImages = imageRefsFor(currentText)
        if (currentText === draftText && sameImageRefs(currentImages, draftImages)) {
          clearDeliveredDraft()
        }
      }).catch((error: unknown) => {
        if (!draftImageLeaseIsCurrent(lease)) return
        channel.notify(error instanceof Error ? error.message : String(error), {
          color: 'error',
          timeoutMs: 5000,
        })
      }).finally(() => {
        if (pendingCommandRef.current?.token === attempt.token) pendingCommandRef.current = null
      })
    }
    return handled !== false
  }

const chooseCommand = (text: string): void => {
    const { channel } = getContext()


    if (tryRunCommand(text)) return
    if (channel.working) steerSend(text)
    else submitText(text)
  }

const handleEnter = () => {
    const { lastEnterAtRef, valueRef, dockSelectedRef, dockCount, editDocked, overlayOpen, suggestions, selectedCommand, fileOverlayOpen, fileMatches, fileSelected, acceptFile, channel } = getContext()


    // A single Enter can arrive as two events in cmd pipelines (`\r`
    // parsed as return + a raw `\n` line): collapse them so one keypress
    // never sends the message twice.
    const now = Date.now()
    if (now - lastEnterAtRef.current < 80) return
    lastEnterAtRef.current = now
    const value = valueRef.current
    // The docked-queue selector owns Enter while a row is highlighted and
    // the draft is untouched: retract that row into the input for editing.
    if (dockSelectedRef.current !== null && value.trim() === '' && dockCount > 0) {
      editDocked(dockSelectedRef.current)
      return
    }
    if (overlayOpen) {
      const command = suggestions[selectedCommand]
      if (command) {
        chooseCommand(command.commandLine)
        return
      }
    }
    // File-completion overlay open → Enter accepts the selection (same
    // contract as the command menu: the overlay owns Enter while open).
    if (fileOverlayOpen) {
      const file = fileMatches[fileSelected]
      if (file) {
        acceptFile(file)
        return
      }
    }
    // A docked queue (Esc parked it) owns a bare Enter on an EMPTY draft
    // (Claude Code parity: "…or Enter to send them now"). A draft in
    // progress keeps the ordinary submit path and the dock stays parked —
    // sending parked messages silently along with the next typed submit is
    // exactly the surprise the dock exists to prevent.
    if (value.trim() === '' && !channel.working && dockCount > 0) {
      sendDocked()
      return
    }
    if (channel.working && value.trim() !== '') {
      // Host skill commands may run during a turn. Other model input steers
      // the active turn, while unsupported local commands are refused.
      const parsed = value.startsWith('/') ? parseCommandName(value) : undefined
      if (parsed !== undefined && (
        channel.commandList.some(command => command.name === parsed.name && (parsed.name === 'skills' || command.skill === true))
        || 'usage' in resolveLocalCommandPath(parsed.name, parsed.rawInput)

      )) {
        if (tryRunCommand(value)) return
      }
      steerSend(value)
      return
    }
    if (!tryRunCommand(value)) submitText(value)
  }
  return { clearDeliveredDraft, sameImageRefs, shellImagesUnsupported, submitText, steerSend, queueSend, sendDocked, interruptSend, tryRunCommand, chooseCommand, handleEnter }
}
