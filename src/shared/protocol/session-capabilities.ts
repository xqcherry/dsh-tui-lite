import type { AgentEvent } from './events.js'

/** A user decision on one permission prompt. */
export type PermissionDecision =
  | { readonly kind: 'allow-once' }
  /** `optionId` picks one allow-always option when the prompt offers several. */
  | { readonly kind: 'allow-always'; readonly optionId?: string }
  /** `message` is the user's own reason, relayed to the model. */
  | { readonly kind: 'reject'; readonly message?: string }

/** Input retraction is supplied by the active dsh session. */
export interface SessionCapabilities {
  readonly pendingRetraction?: { remove(clientMessageId: string): boolean }
}

export interface SubagentTranscriptPage {
  readonly events: readonly AgentEvent[]
  readonly parentAgentId: string | null
  /** The SessionMessage uuids the events cover (dedup keys: the live tail
   *  and an overlapping reload drop what these already account for). */
  readonly uuids: readonly string[]
  /** Older messages exist on disk before this page's first message. */
  readonly hasOlder: boolean
  /** Messages the disk transcript holds before this page's first message
   *  (the next older window asks for skipFromStart - count). */
  readonly skippedFromStart: number
}

/** An older slice request: `count` messages ending just before
 *  `skipFromStart` (the pagination bookkeeping of the page already shown). */
export interface SubagentTranscriptWindow {
  readonly count: number
  readonly skipFromStart: number
}
