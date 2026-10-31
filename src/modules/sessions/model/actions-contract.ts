import type { PreviewEntry, SessionSummary } from '../../../shared/protocol/session-catalog.js'
import type { ResumeResult } from '../../../shared/protocol/session.js'

/** SessionActions: client-owned operations. */
export interface SessionActions {
  /** Switch the live agent to a persisted session, replaying its history. */
  resumeTo(sessionId: string): Promise<ResumeResult>
  /** Start a fresh conversation (`/new`): a brand-new agent + session, the
   *  transcript cleared, the resume marker forgotten. */
  newSession(): Promise<boolean>
  /** Reset the visible transcript (`/clear`). */
  clear(): void
  /**
   * Re-render rows older than the current in-memory window from the session
   * log (rows beyond {@link ChannelState.rows}' cap are folded away; this
   * restores them for review). Returns the number of rows restored, 0 when
   * the whole log is already materialized.
   */
  loadOlder(): number
  /** Every session the persistence backend stores, classified and unfiltered
   *  — the browser (`/resume`) decides which of them a given view shows. */
  /** Last successful source-scoped listing for first paint; never authoritative. */
  cachedSessions(): readonly SessionSummary[] | undefined
  listSessions(onEnriched?: (summary: SessionSummary) => void, onPartial?: (rows: readonly SessionSummary[]) => void): Promise<readonly SessionSummary[]>
  /** Trailing exchanges of a persisted session, for the browser's preview. */
  previewSession(sessionId: string): Promise<readonly PreviewEntry[]>
  /** Mark a session for `dsh-tui --resume` on the next launch. */
  setResumeTarget(sessionId: string): void
  /** Rename the current session (`/rename`): appends a `session/title`
   *  event, which the status line and the /resume picker both read. */
  renameSession(title: string): void
  /** Delete a persisted session (`/resume` picker ctrl+d): removes its log
   *  directory, its last-used entry, and the resume marker when it points
   *  here. False for the live session or a missing/unwritable log. */
  deleteSession(sessionId: string): Promise<boolean>
  /** Rename any persisted session (`/resume` picker ctrl+r): appends a
   *  `session/title` event to its log (live sessions go through the normal
   *  rename path). False when the log is absent or undecodable. */
  renameSessionTo(sessionId: string, title: string): Promise<boolean>
  /** Manually compact the session history (`/compact`); no-op notify when the leaf lacks a compaction service. */
  compact(): void
  /** Abort an in-flight manual compaction (`Esc` while it runs). No-op when
   *  none is running or the running one belongs to another process/host: only
   *  this channel's own request carries an abort signal it may fire. */
  cancelCompact(): void
  /** Write the conversation transcript to `dsh-tui-export-<ts>.md` in the
   *  session cwd; returns the written path, or null on failure. */
  exportSession(): string | null
}
