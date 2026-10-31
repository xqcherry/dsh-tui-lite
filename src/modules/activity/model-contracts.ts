import type { CostTokenBuckets } from '../../shared/protocol/transcript.js'

/** Minimal stream protocol accepted by activity reducers. */
export interface ActivityUsage {
  inputTokens?: number
  outputTokens?: number
  input?: number
  output?: number
  total?: number
  context?: number
}

interface ActivityFrameBase { revision: number; attemptId: string }
export type ActivityAssistantStreamFrame =
  | (ActivityFrameBase & { type: 'start'; turn: number; step: number })
  | (ActivityFrameBase & { type: 'end' })
  | (ActivityFrameBase & { type: 'chunk'; chunk: { type: string; text?: string; usage?: ActivityUsage } })

/** Durable event data is narrowed at the host boundary, never a host class. */
export interface SubagentEventData {
  chunk?: { type?: string; text?: string; usage?: ActivityUsage }
  message?: { content?: readonly unknown[]; source?: { callId?: string }; isError?: boolean }
  stream?: unknown
  turn?: unknown
  step?: unknown
  usage?: ActivityUsage
  callId?: string
  name?: string
  arguments?: string
  error?: unknown
}

export interface SubagentCostPolicy {
  empty(): CostTokenBuckets
  clone(buckets: CostTokenBuckets): CostTokenBuckets
  add(buckets: CostTokenBuckets, usage: { input: number; output: number; cacheRead: number; cacheWrite: number }, peak: boolean): void
  isPeakHour(at: Date): boolean
  isPriced(provider: string, model: string): boolean
}

/** Captured host identity used for parent ownership; opaque sessions stay opaque. */
export interface ActivityProjectionHost {
  readonly id: string
  readonly session: { readonly id: unknown }
}

/** Transcript owns row IDs, ordering and the stored row objects. */
export interface ActivityTranscriptTarget {
  readonly ingress: {
    upsertActivityRow(key: string, row: {
      kind: 'job' | 'subagent'
      text: string
      job?: import('../../shared/protocol/jobs.js').JobRow
      subagent?: import('../../shared/protocol/subagents.js').SubagentRow
    }): void
    resetActivityRows(kind: 'job' | 'subagent'): void
  }
}
