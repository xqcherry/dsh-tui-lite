import { createCommandLifetime } from '../../../shared/lifecycle/module-commands.js'
import type { ComposerCommandHost } from '../contracts.js'
import { createModuleStore, type Publication, type MutableSnapshot } from '../../../shared/state/module-store.js'
import type { ComposerSnapshot, ComposerCommands } from '../state-contracts.js'
import type { InputConvergence } from './actions.js'
import type { ModuleLaunch } from '../../../shared/protocol/module-launch.js'

/** This module is the sole owner of these fields. Writers never reach the UI. */
export function createComposerModule(launch: ModuleLaunch, publication: Publication) {
  const convergence: InputConvergence = { interruptSeq: 0, cancelInFlight: false, cancelCause: undefined }
  const lifetime = createCommandLifetime<ComposerCommandHost>(publication)
  const owned = createModuleStore<MutableSnapshot<ComposerSnapshot>>({
    selection: undefined,
    cancelPending: false,
    pending: [],
  }, publication)
  const commands = Object.freeze<ComposerCommands>({
    stageImage: (...args) => lifetime.call(host => host.stageImage(...args)),
    stagedImageGeneration: (...args) => lifetime.call(host => host.stagedImageGeneration(...args)),
    stageComposerImage: (...args) => lifetime.call(host => host.stageComposerImage(...args)),
    hasStagedImage: (...args) => lifetime.call(host => host.hasStagedImage(...args)),
    discardStagedImage: (...args) => lifetime.call(host => host.discardStagedImage(...args)),
    stagedImage: (...args) => lifetime.call(host => host.stagedImage(...args)),
    stagedImageLimits: (...args) => lifetime.call(host => host.stagedImageLimits(...args)),
    submit: (...args) => lifetime.call(host => host.submit(...args)),
    steer: (...args) => lifetime.call(host => host.steer(...args)),
    removePending: (...args) => lifetime.call(host => host.removePending(...args)),
    cancel: (...args) => lifetime.call(host => host.cancel(...args)),
    interruptAndDeliver: (...args) => lifetime.call(host => host.interruptAndDeliver(...args)),
    interruptAndDock: (...args) => lifetime.call(host => host.interruptAndDock(...args)),
    deliverDocked: (...args) => lifetime.call(host => host.deliverDocked(...args)),
    swapDockedForDraft: (...args) => lifetime.call(host => host.swapDockedForDraft(...args)),
    commandCompletions: (...args) => lifetime.call(host => host.commandCompletions(...args)),
    listFileCandidates: (...args) => lifetime.call(host => host.listFileCandidates(...args)),
    listFiles: (...args) => lifetime.call(host => host.listFiles(...args)),
  })
  return {
    connectHost: lifetime.connect,
    startCommands: lifetime.start,
    store: owned.store,
    commands,
    ingress: {
      setSelection(selection: ComposerSnapshot['selection']): void { owned.patch({ selection }) },
      setCancelPending(cancelPending: boolean): void { owned.patch({ cancelPending }) },
      setPending(pending: ComposerSnapshot['pending']): void { owned.patch({ pending: [...pending] }) },
      trackPending(message: ComposerSnapshot['pending'][number]): void { owned.update(draft => { draft.pending.push(message) }) },
      untrackPending(id: string): void { owned.update(draft => { draft.pending = draft.pending.filter(item => item.id !== id) }) },
      read: owned.read,
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
      resetSessionState(): void { owned.patch({ pending: [], cancelPending: false }) },
    },
    dispose() { lifetime.dispose(); owned.dispose() },
  }
}
