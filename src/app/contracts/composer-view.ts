
/** Host-owned in-process Channel contract. No runtime or upstream imports. */

/** Live editor selection projection (IDE selection channel): the editor
 *  buffer's own text when the IDE pushed it (protocol 2 — unsaved edits
 *  included), plus the coordinates. Structurally mirrors the adapter's
 *  SelectionSnapshot without importing from the adapter layer (this port
 *  takes no runtime or upstream imports). */
export interface ChannelSelection {
  /** Workspace-relative or absolute file path, as the extension reports it. */
  readonly path: string
  /** First selected line, 0-based. */
  readonly startLine: number
  /** Last selected line, 0-based inclusive. */
  readonly endLine: number
  /** True when the editor selection collapsed to nothing. */
  readonly isEmpty: boolean
  /**
   * Protocol 2: the editor buffer's own text for the selection, exactly
   * what the user saw. The submit path attaches it verbatim; when absent
   * (protocol-1 push) it falls back to reading the file from disk.
   */
  readonly text?: string
  /** Protocol 2: the editor document version the text came from. */
  readonly documentVersion?: number
}

/** What one consumed selection contributed to a submitted message, recorded
 *  next to the user row so the transcript can render a "Selected N lines
 *  from <file>" indicator. `lines` is the count actually attached after
 *  clamping — the truth the model received, not the request. */
export interface SelectionAttachment {
  readonly lines: number
  /** The path as the extension reported it (absolute or workspace-relative). */
  readonly path: string
}

/**
 * One context a side panel staged into the composer ("Send to Chat", §6.7):
 * the panel row's own title plus the model-facing text. The composer renders
 * a chip per entry above the input row, and the NEXT submission appends the
 * `<attached-context …>` block — the same one-shot consumption the IDE
 * selection channel next door performs (a staged context is spent by the
 * message that carried it).
 */
export interface AttachedContext {
  /** Stable handle minted by the channel (`ctx-N`), used to detach one entry. */
  readonly id: string
  /** Where the context came from. Only panels exist today; the discriminant
   *  is explicit so a future source cannot be mistaken for a panel row. */
  readonly source: 'panel'
  /** Identity of the contributing row INSIDE its panel (a job id, a session
   *  id, …) — paired with `title` it is the replace key. */
  readonly sourceId: string
  /** Human-facing label for the composer chip (e.g. `Job #142`). */
  readonly title: string
  /** Model-facing body, already capped at `MENTION_MAX_FILE_CHARS`. */
  readonly content: string
  /** Length of `content` after the cap — what the model will actually get. */
  readonly chars: number
  /** True when the panel's content exceeded the cap and was cut at attach
   *  time; the block builder then appends the visible `[… truncated]` marker. */
  readonly truncated: boolean
}

/** @internal */
/** One user message submitted while the model was working, not yet claimed
 *  by a turn. `steer` lands at the next step boundary of the running turn;
 *  `followup` waits for the turn to end. */
export interface PendingMessage {
  id: string
  text: string
  images: readonly ComposerImageRef[]
  placement: 'steer' | 'followup'
  /** Parked channel-side by an interrupt (Esc, as in Claude Code): the
   *  backend dropped its queued copy with the aborted turn, this preview is
   *  the only remaining copy, and nothing delivers it until the user sends
   *  the dock (⏎ / deliverDocked) or retracts it (Alt+↑ / the ↑ editor). */
  docked?: boolean
}

export interface StagedImageInput {
  data: Uint8Array
  mediaType: ChannelImageMediaType
  name?: string
  /** Absolute local path the bytes were read from, for the preview card's
   *  path row. Not handed to the attachment store and never persisted. */
  path?: string
}

/** UI-safe facade for one durable image block in the session transcript. */
export interface TranscriptImage {
  readonly id: string
  readonly width: number
  readonly height: number
  readonly name?: string
  /** Verified media type, when the durable reference carries one. */
  readonly mediaType?: string
  /** Stored byte size, when the durable reference carries one. */
  readonly bytes?: number
  /**
   * Absolute local path the bytes were staged from in THIS process: a pasted
   * or dropped file, or the clipboard bitmap's temp export. Display-only and
   * never persisted — the durable event carries a content hash, so images
   * restored from the session log have none.
   */
  readonly path?: string
  read(signal?: AbortSignal): Promise<Uint8Array>
}

/** What an adapted paste ended up as, so the composer can report it instead of
 * a re-encode happening silently. Present only when the ingress gate had to
 * change the bytes. Dimensions and media type are the STORE's report for what
 * it persisted (it normalizes further on its own), i.e. what the user gets. */
export interface StagedImageAdjustment {
  /** Media type the bytes were declared with (the pasted file's type). */
  readonly sourceMediaType: ChannelImageMediaType
  /** Media type the store reports for the stored bytes. */
  readonly mediaType: ChannelImageMediaType
  /** Stored pixel dimensions as the store reports them. */
  readonly width: number
  readonly height: number
  /** The stored image is smaller than what the gate handed over. */
  readonly resized: boolean
  /** This gate composited an alpha channel onto an opaque background. */
  readonly flattened: boolean
}

/** Opaque capability returned for one staged composer image. The visible
 * `[Image #N]` label is deliberately absent: PromptInput owns presentation
 * numbering while this id is the non-reusable attachment identity. */
export interface StagedImageHandle {
  readonly stageId: string
  /** How the ingress gate adapted the pasted bytes, when it had to. */
  readonly adjustment?: StagedImageAdjustment
}

/** One visible composer token bound to its opaque staged-image capability. */
export interface ComposerImageRef {
  readonly token: string
  readonly stageId: string
}

/** Text plus the image capabilities that belong to that exact draft. */
export interface ComposerSubmission {
  readonly text: string
  readonly images?: readonly ComposerImageRef[]
}
export type ChannelImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
