

import type { PendingMessage } from '../../../../shared/protocol/composer.js'

import { appendHistory, HISTORY_LIMIT, historyProjectKey, loadHistoryOldestFirst } from '../../model/history.js'


import type { PromptHistoryEntry, DraftUndoEntry, UndoMode } from '../../model/editing.js'

import React from 'react'


import type { ComposerImageRef } from '../../../../shared/protocol/composer.js'
import { t } from '../../../../shared/i18n.js'
import type { ComposerBinding } from '../../contracts.js'
import type { ComposerContext } from '../types.js'


interface Context {
  readonly composer: ComposerBinding
  readonly context: ComposerContext
  readonly historySeededProject: React.RefObject<string | null>
  readonly historyIndex: React.RefObject<number>
  readonly history: React.RefObject<PromptHistoryEntry[]>
  readonly updateFoldBlock: (block: { start: number; end: number; } | null) => void
  readonly restoreDraftImages: (entry: PromptHistoryEntry) => void
  readonly historyDraft: React.RefObject<PromptHistoryEntry>
  readonly setInput: (next: string, cursorOffset?: number, undo?: UndoMode, snapshotBlock?: DraftUndoEntry["block"]) => void
  readonly setDockSelected: (index: number | null) => void
  readonly setSelectedCommand: React.Dispatch<React.SetStateAction<number>>
  readonly setFileSelected: React.Dispatch<React.SetStateAction<number>>
  readonly dockedPending: PendingMessage[]
  readonly valueRef: React.RefObject<string>
  readonly imageRefsFor: (text: string) => ComposerImageRef[]
  readonly foldBlockRef: React.RefObject<{ start: number; end: number; } | null>
  readonly replaceDraftImages: (images: readonly ComposerImageRef[]) => void
}

export function createHistoryNavigation(getContext: () => Context) {
const seedHistory = (): boolean => {
    const { composer, context, historySeededProject, historyIndex, history } = getContext()


    // The store's own key, not the raw cwd: `/repo` and `/repo/` are one
    // project, so respelling the path must not look like a workspace switch.
    const project = historyProjectKey(context.sessions.getSnapshot().cwd) ?? ''
    if (historySeededProject.current === project) return false
    const interrupted = historyIndex.current >= 0
    historySeededProject.current = project
    history.current = loadHistoryOldestFirst(context.sessions.getSnapshot().cwd).map(entry => ({ text: entry.text, images: [] }))
    historyIndex.current = -1
    return interrupted
  }

const restoreHistoryDraft = (): void => {
    const { historyIndex, updateFoldBlock, restoreDraftImages, historyDraft, setInput } = getContext()


    historyIndex.current = -1
    updateFoldBlock(null)
    restoreDraftImages(historyDraft.current)
    // A recall is not undoable (D4): `restoreDraftImages` just ended the
    // history, so the restore must not push a step of its own.
    setInput(historyDraft.current.text, historyDraft.current.text.length, 'silent')
  }

const rememberHistory = (text: string, images: readonly ComposerImageRef[]): void => {
    const { history, historyIndex, composer, context } = getContext()


    // Both entries into the walk (a submit and ↑) must see the persisted
    // prefix, so seed here rather than merging two lists later.
    seedHistory()
    history.current.push({
      text,
      images: images.map(image => ({ ...image })),
    })
    if (history.current.length > HISTORY_LIMIT) history.current.shift()
    historyIndex.current = -1
    void appendHistory(text, context.sessions.getSnapshot().cwd)
  }

const pullBackLast = () => {
    const { setDockSelected, composer, context, restoreDraftImages, setInput, updateFoldBlock, setSelectedCommand, setFileSelected } = getContext()


    // Alt+↑ keeps its direct last-item meaning even while the dock selector
    // is open — one press, one retracted row (the selector closes with it).
    setDockSelected(null)
    const item = composer.store.getSnapshot().pending[composer.store.getSnapshot().pending.length - 1]
    if (!item) return
    if (!composer.commands.removePending(item.id)) {
      context.notify(t('input-cannot-retract'), { color: 'warning', timeoutMs: 2500 })
      return
    }
    restoreDraftImages({
      text: item.text,
      images: item.images ?? [],
    })
    setInput(item.text, item.text.length, 'silent')
    updateFoldBlock(null)
    setSelectedCommand(0)
    setFileSelected(0)
    context.notify(t('input-retracted'), { timeoutMs: 2000 })
  }

const retractRecalledCopy = (text: string): void => {
    const { composer, context } = getContext()


    let target: PendingMessage | undefined
    for (const item of composer.store.getSnapshot().pending) {
      if (item.text === text) target = item
    }
    if (target === undefined) return
    if (composer.commands.removePending(target.id)) {
      context.notify(t('input-retracted'), { timeoutMs: 2000 })
    } else {
      context.notify(t('input-cannot-retract'), { color: 'warning', timeoutMs: 2500 })
    }
  }

const editDocked = (index: number): void => {
    const { dockedPending, setDockSelected, valueRef, composer, context, imageRefsFor, foldBlockRef, updateFoldBlock, setInput, replaceDraftImages, setSelectedCommand, setFileSelected, restoreDraftImages } = getContext()


    const item = dockedPending[index]
    setDockSelected(null)
    if (item === undefined) return
    if (valueRef.current.trim() !== '') {
      // Park the draft FIRST: its capabilities must already be retained by
      // the pending row when setInput's undo bookkeeping and sidecar pruning
      // run below, or a later swap-back would find them discarded.
      const swapped = composer.commands.swapDockedForDraft(item.id, {
        text: valueRef.current,
        images: imageRefsFor(valueRef.current),
      })
      if (!swapped) {
        context.notify(t('input-cannot-retract'), { color: 'warning', timeoutMs: 2500 })
        return
      }
      // One sealed undo step captures the draft the swap replaces (same
      // shape as the external-editor refill): snapshot the fold block
      // BEFORE clearing it, so Ctrl+Z restores the chip too. setInput runs
      // while the sidecar still maps the parked draft's tokens — the undo
      // snapshot then carries them, and its pruning sees the pending row
      // already retains every capability (nothing is discarded).
      const beforeBlock = foldBlockRef.current
      updateFoldBlock(null)
      setInput(item.text, item.text.length, 'step', beforeBlock)
      replaceDraftImages(item.images ?? [])
      setSelectedCommand(0)
      setFileSelected(0)
      context.notify(t('input-dock-swapped'), { timeoutMs: 2000 })
      return
    }
    if (!composer.commands.removePending(item.id)) {
      context.notify(t('input-cannot-retract'), { color: 'warning', timeoutMs: 2500 })
      return
    }
    restoreDraftImages({
      text: item.text,
      images: item.images ?? [],
    })
    setInput(item.text, item.text.length, 'silent')
    updateFoldBlock(null)
    setSelectedCommand(0)
    setFileSelected(0)
    context.notify(t('input-retracted'), { timeoutMs: 2000 })
  }
  return { seedHistory, restoreHistoryDraft, rememberHistory, pullBackLast, retractRecalledCopy, editDocked }
}
