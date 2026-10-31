import type { ComposerImageRef, ComposerSubmission, StagedImageHandle, StagedImageInput, TranscriptImage } from './composer-view.js'

/** ComposerActions: client-owned operations. */
export interface ComposerActions {
  /** Current composer generation. Async paste continuations capture this
   *  before I/O and must not mutate a different session's draft. */
  stagedImageGeneration(): number
  /** Validate and persist a pasted image, returning its prompt placeholder. */
  stageImage(input: StagedImageInput): Promise<string>
  /** Draft-safe composer companion: bind persistence to one session epoch
   * and return an opaque capability whose visible label belongs to Prompt. */
  stageComposerImage(input: StagedImageInput, generation: number): Promise<StagedImageHandle>
  /** Whether a capability is still live in the current composer session. */
  hasStagedImage(stageId: string): boolean
  /** Revoke a capability that was staged for a draft which no longer exists.
   * Durable attachment storage remains content-addressed; this only releases
   * the editable-composer lookup and its preview facade. */
  discardStagedImage(stageId: string): void
  /** The staged image behind one opaque capability, as the same lazily-read
   *  facade transcript rows use; undefined once evicted or cleared. */
  stagedImage(stageId: string): TranscriptImage | undefined
  /** The profile's image-paste limits, for callers that must bound work
   *  BEFORE reading bytes (a Finder path is untrusted input). Undefined
   *  when the composition has no attachment service. */
  stagedImageLimits(): {
    readonly maxImageBytes: number
    readonly maxImagesPerMessage: number
    readonly maxImageDimension: number
    readonly maxImagePixels: number
  } | undefined

  submit(text: string, images?: readonly ComposerImageRef[]): void
  /**
   * Steer a message into the running turn (Codex/pi semantics): injected at
   * the next step boundary, the agent continues without aborting.
   */
  steer(text: string, images?: readonly ComposerImageRef[]): void
  /** Pull a pending message back out of the inbox (Alt+Up) for re-editing. */
  removePending(id: string): boolean
  /** Abort the in-flight turn (`Ctrl+C` while working). While `cancelPending`
   *  stays true the abort has not converged; Chat force-exits on the next
   *  Ctrl+C press in that window. */
  cancel(): void
  /** Abort the in-flight turn and process `texts` right away (Ctrl+Enter
   *  with queued input): each text is re-queued as a followup once the abort
   *  settles, so the new turn starts immediately. Returns the count queued. */
  interruptAndDeliver(inputs: readonly (string | ComposerSubmission)[]): number
  /** Esc with queued input: abort the turn and park the queued previews as a
   *  dock, as Claude Code does. The backend drops its queued copies with the
   *  aborted turn, and nothing re-delivers them until the user sends the
   *  dock (⏎ / `deliverDocked`) or retracts items (Alt+↑ / the ↑ editor).
   *  Returns the count docked; 0 means nothing new was parked (the caller
   *  may still `cancel`). */
  interruptAndDock(): number
  /** Deliver every docked queued message now (⏎ on an empty draft), FIFO,
   *  exactly once. Rows still awaiting their interrupt receipt's verdict
   *  stay parked, since their backend copies may yet run, and the call
   *  notifies how many were held. Returns the count sent. */
  deliverDocked(): number
  /**
   * Lossless swap: retract the docked row `id` into the composer and park
   * the live draft (text + staged images) at the pending tail as a new
   * docked row, in one queue write. Nothing sends and no undo history is
   * lost. The backend never saw the parked draft, so it stays outside the
   * interrupt-receipt fence: a settling receipt must not un-dock it.
   * Returns false when `id` is no longer a docked row (claimed, discarded or
   * un-docked meanwhile), or while an unsettled interrupt receipt still
   * holds the row.
   */
  swapDockedForDraft(id: string, draft: { text: string; images?: readonly ComposerImageRef[] }): boolean
}
