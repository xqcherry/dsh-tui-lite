import type { InputConvergence } from './actions.js'
import { createModuleStore, type Publication, type MutableSnapshot } from '../../../shared/state/module-store.js'
import type { ComposerSnapshot, ComposerCommands } from '../state-contracts.js'
import type { ModuleLaunch } from '../../../shared/protocol/module-launch.js'

/** This module is the sole owner of these fields. Writers never reach the UI. */
export function createComposerModule(launch: ModuleLaunch, commands: ComposerCommands, publication: Publication) {
  const convergence: InputConvergence = { interruptSeq: 0, cancelInFlight: false, cancelCause: undefined }
  const { options, input } = launch
  const owned = createModuleStore<MutableSnapshot<ComposerSnapshot>>({
    selection: undefined,
    cancelPending: false,
    pending: [],
  }, publication)
  return {
    store: owned.store,
    commands,
    ingress: {
      setSelection(selection: ComposerSnapshot['selection']): void { owned.patch({ selection }) },
      setCancelPending(cancelPending: boolean): void { owned.patch({ cancelPending }) },
      setPending(pending: ComposerSnapshot['pending']): void { owned.patch({ pending: [...pending] }) },
      trackPending(message: ComposerSnapshot['pending'][number]): void { owned.update(draft => { draft.pending.push(message) }) },
      untrackPending(id: string): void { owned.update(draft => { draft.pending = draft.pending.filter(item => item.id !== id) }) },
      convergence,
      resetBindingConvergence(): void { convergence.cancelInFlight = false; convergence.interruptSeq += 1 },
      clearCancellation(): void { convergence.cancelInFlight = false; owned.patch({ cancelPending: false }) },
      retirePending(messageId: string, discarded: boolean): boolean {
        const before = owned.read().pending.length
        owned.update(draft => {
          draft.pending = draft.pending.filter(item => item.id !== messageId || (item.docked === true && discarded))
        })
        return owned.read().pending.length !== before
      },
      resetSessionState(): void { owned.patch({ pending: [], cancelPending: false }) }, patch: owned.patch, update: owned.update, read: owned.read },
    dispose: owned.dispose,
  }
}
