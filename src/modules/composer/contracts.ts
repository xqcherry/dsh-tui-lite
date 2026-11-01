export type { InputConvergence } from './model/actions.js'

export type { ComposerActions } from './model/actions-contract.js'

export type { ComposerSnapshot, ComposerCommands, ComposerBinding } from './state-contracts.js'

export interface ComposerEventIngress {
  clearCancellation(): void
  /** A claim always retires its row; a discard leaves a docked preview owned here. */
  retirePending(messageId: string, discarded: boolean): boolean
  resetSessionState(): void
}

export type { ComposerImageLimits, ImageCapabilityHost } from './model/image-capabilities.js'
export type { InputQueueHost } from './model/input-queue.js'

/** Host capabilities consumed by the composer command owner. */
export type ComposerCommandHost = import('./state-contracts.js').ComposerCommands
