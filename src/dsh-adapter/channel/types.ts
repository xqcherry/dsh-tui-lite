import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { RawTrajEvent } from '../../shared/protocol/session.js'
import type { ToolCallView, ToolResultView } from '../../shared/protocol/transcript.js'
export type { ComposerImageRef, ComposerSubmission, PendingMessage, StagedImageAdjustment, StagedImageHandle, StagedImageInput, TranscriptImage } from '../../shared/protocol/composer.js'
export type { JobControl, JobRow } from '../../shared/protocol/jobs.js'
export type { CredentialStatus, EffortOption, PermissionPresetAvailability, PermissionPresetCurrent, PermissionPresetOption, PermissionPresetSnapshot, PresetOption, SkillInfo } from '../../shared/protocol/models.js'
export type { AgentViewDispatchResult, AgentViewRow, AgentViewStatus, BackgroundResult, ChannelGoal, ExternalCommandOutcome, LoadedContext, LoadedContextEntry, LoadedContextFile, LoadedContextSkill, LoadedContextTool, NotificationItem, ResumeResult, TodoPanelItem, TrajectorySource } from '../../shared/protocol/session.js'
export type { SubagentControl, SubagentRow, SubagentTranscriptView } from '../../shared/protocol/subagents.js'
export type { ChatRow, CostTokenBuckets, SessionCostByModel, SubagentCostEntry, TokenBucket, TokenUsage, ToolCallView, ToolFileDiff, ToolResultView, ToolRow } from '../../shared/protocol/transcript.js'

export type PermissionPresetService = {
  names?: unknown
  current?: (events: readonly RawTrajEvent[]) => unknown
  optionOf?: (name: string) => unknown
}

export type ChannelImageBlock = Extract<ContentBlock, { type: 'image' }>

export type ChannelImageMediaType = ChannelImageBlock['attachment']['mediaType']

/** The dsh-tools registry seam dsh-tui reads presentations through. The
 *  registry lives on the host plane; `get` takes the live agent as the
 *  scope so a preset's own tool definitions resolve (dsh-host-apiproxy's
 *  presenter pattern). */
export interface ToolsRegistryLike {
  get(name: string, scope?: unknown): {
    presentCall?(args: unknown): unknown
    presentResult?(args: unknown, result: unknown): unknown
  } | undefined
}

/** Re-derives the presentation views foldRows dropped, threaded into
 *  foldBack (module-level, no ctx access) by the channel. */
export interface ToolViewPresenter {
  call(name: string, rawArgs: string): ToolCallView | undefined
  result(name: string, rawArgs: string, data: SessionEvent<'tool/result'>['data']): ToolResultView | undefined
}

export type FileSuggestionFs = {
  resolve(path: string): Promise<{ displayPath: string }>
  listDir(target: { displayPath: string }): Promise<Array<{ name: string; type: 'file' | 'directory' | 'other'; target?: { displayPath: string } }>>
}

/** The fs-service surface `@`-mention expansion consumes (dsh-fs-local). */
export interface MentionFs {
  resolve(path: string): Promise<{ displayPath: string }>
  stat(target: { displayPath: string }): Promise<{ type: 'file' | 'directory' | 'other' } | undefined>
  readText(target: { displayPath: string }): Promise<string>
  readBytes?(target: { displayPath: string }, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>
  listDir(target: { displayPath: string }): Promise<Array<{ name: string; type: 'file' | 'directory' | 'other' }>>
}

export type MentionImageBlock = ChannelImageBlock

export type MentionImageMediaType = ChannelImageMediaType

/** Attachment subset used to turn an image path into a durable user block. */
export interface MentionAttachments {
  readonly imageLimits: {
    readonly maxImageBytes: number
    readonly maxImagesPerMessage: number
    readonly maxMessageImageBytes: number
    /** Per-side intrinsic pixel cap (mirrored from the upstream store's
     *  ImageAttachmentLimits — used by the composer's ingress resample). */
    readonly maxImageDimension: number
    /** Total-pixel cap ditto. */
    readonly maxImagePixels: number
    readonly mediaTypes: readonly MentionImageMediaType[]
  }
  saveImage(input: { data: Uint8Array; mediaType: MentionImageMediaType; name?: string }): Promise<MentionImageBlock['attachment']>
}

/** One mention target that resolved and stat'ed to something attachable. */
export interface ResolvedMention {
  target: { displayPath: string }
  info: { type: 'file' | 'directory' | 'other' }
}

export interface MentionExpansion {
  /** Model-facing blocks: the typed text first, one block per attachment. */
  blocks: ContentBlock[]
  /** Paths that resolved and were attached (for the confirmation notice). */
  attached: string[]
  /** Mention tokens that failed to resolve (kept literal, warned about). */
  missing: string[]
}
