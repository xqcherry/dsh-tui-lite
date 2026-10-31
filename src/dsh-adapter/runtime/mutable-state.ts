import type { Client } from './client.js'
import type { PendingMessage } from '../../shared/protocol/composer.js'
import type { BackgroundJobState } from '../../shared/protocol/jobs.js'
import type { NotificationItem, TodoPanelItem } from '../../shared/protocol/session.js'
import type { SubagentState } from '../../shared/protocol/subagents.js'
import type { ChatRow } from '../../shared/protocol/transcript.js'

type MutableChannelView = { -readonly [K in keyof Client]: Client[K] }

/** Client-owned mutable state; host resources are released through the lifecycle hook. */
export interface ClientState extends Omit<MutableChannelView, 'rows' | 'notifications' | 'todos' | 'pending' | 'tpsSamples' | 'subagents' | 'backgroundJobs'> {

  rows: ChatRow[]
  notifications: NotificationItem[]
  /** Per-turn tps samples (sparkline history), oldest first. */
  tpsSamples: { tps: number; at: number }[]
  /** Latest todo-list snapshot (see the public Channel type). */
  todos: TodoPanelItem[]
  /** Messages submitted while working, awaiting their turn/step boundary.
   *  Driven by agent inbox events (inserted/claimed/discarded). */
  pending: PendingMessage[]
  /** Active subagents roster (see the public Channel type). */
  subagents: readonly SubagentState[]
  /** Background jobs of the current session (see the public Channel type). */
  backgroundJobs: readonly BackgroundJobState[]
  /** @internal event bump (the public `notify(text)` posts a notification). */
  emit(): void
  /** @internal frame-aligned emit for high-frequency streaming deltas:
   *  version bumps synchronously but listeners fire at most once per 16ms
   *  window (trailing edge). */
  emitStream(): void
  /** See {@link ClientState.releaseContributions}. */
  releaseContributions(): void

}
