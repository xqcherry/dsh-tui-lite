

export interface SubagentRow {
  agentId: string
  runId?: string
  description: string
  /** Durable creation mode from the kernel catalog event; absent before the
   *  parent log's `subagent/catalog` fact arrives (bus-only discovery). */
  mode?: 'one-shot' | 'continuable' | 'unknown'
  provider?: string
  model?: string
  effort?: string
  status: SubagentState['status']
  startedAt: number
  completedAt?: number
  durationMs?: number
  outputLines: string[]
  toolCalls: SubagentState['toolCalls']
  tokens?: SubagentState['tokens']
  summary?: string
  stopReason?: string
  error?: string
  /** Runs in the background (the delegating call returned at launch). */
  background?: boolean
  /** Spawn nesting: 1 = spawned by the main loop, N+1 = by a depth-N agent. */
  depth?: number
}

export interface SubagentState {
  agentId: string
  runId?: string
  description: string
  /** Durable creation mode from `subagent/catalog` (one-shot burns out;
   *  continuable survives epochs and can take later prompts). */
  mode?: 'one-shot' | 'continuable' | 'unknown'
  provider?: string
  model?: string
  effort?: string
  status: SubagentStatus
  startedAt: number
  completedAt?: number
  endedAt?: number
  local?: boolean
  parentSessionId?: string
  sessionId?: string
  stopReason?: string
  error?: string
  /** Compatibility projection for older consumers. */
  output: string[]
  outputEvents: SubagentOutputLine[]
  toolCalls: SubagentToolCall[]
  tokens?: SubagentTokenUsage
  /** The backend's own tool-count report (`usage.tool_uses`). Preferred
   *  over the locally kept records, which miss lane frames. */
  reportedToolUses?: number
  /** The backend's own duration report (`usage.duration_ms`), free of the
   *  host's receive delay; per run (a resumed run reports its own). */
  reportedDurationMs?: number
  /** The tool the backend last saw the subagent run (`task_progress`). */
  lastTool?: string
  summary?: string
  /** Runs in the background (the delegating call returned at launch). */
  background?: boolean
  /** Spawn nesting: 1 = spawned by the main loop, N+1 = by a depth-N agent. */
  depth?: number
  /** The agent that spawned this child, when the backend stated it as a
   *  fact (Claude resume back-fill: `parent_agent_id` / the delegating
   *  transcript). Absent = parent unknown: depth 1 still means a main-loop
   *  child, but no deeper tree is inferred from depth alone. Drives the
   *  workbench parent/sibling panel. */
  parentAgentId?: string
}

/** Unified subagent activity domain model used by the adapter and every view. */

export type SubagentStatus = 'starting' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'

export interface SubagentOutputLine {
  kind: SubagentOutputKind
  text: string
  at: number
  /** False while the line is still absorbing streaming deltas. */
  settled?: boolean
}

export type SubagentOutputKind = 'text' | 'thinking' | 'tool' | 'error' | 'system'

export interface SubagentToolCall {
  id?: string
  name: string
  status: 'running' | 'completed' | 'failed'
  startedAt: number
  endedAt?: number
  argsPreview?: string
  resultPreview?: string
  error?: string
}

export interface SubagentTokenUsage {
  input?: number
  output?: number
  total?: number
  context?: number
}

/**
 * Subagent row: displays a subagent's lifecycle (started → running → completed/failed).
 * Derived from agent.task events and history events.
 */
/**
 * One page of a subagent's own transcript (the agent capability's return;
 * aliased here so the UI port stays free of module imports).
 */
export type SubagentTranscriptView = import('./session-capabilities.js').SubagentTranscriptPage
export interface SubagentControl {
  interrupt(agentId: string): boolean
  /** The child's full transcript source (Claude's on-disk child lane, or
   *  the DSH child's own session log when the composition serves session
   *  persistence). Absent = no transcript source: the transcript UI is not
   *  rendered, and a degraded tail with its retained-range note shows
   *  instead. Null = no such child. */
  history?(agentId: string, window?: import('./session-capabilities.js').SubagentTranscriptWindow): Promise<SubagentTranscriptView | null>
  /** The user→agent message capability, present only when the bound
   *  session's backend actually serves one; when the member is absent the
   *  composer does not render. Backed by real transports only: Claude's
   *  parent-mediated relay, DSH's direct continuable prompt control plane. */
  message?: AgentMessageControl
}

// ── agent-team message domain ───────────────────────────────────────────

/** How one message to an agent travelled. The backend states the
 *  transport; it is never guessed:
 *  'parent-mediated' — the parent model relays through its own SendMessage tool;
 *  'direct-continuable' — the human prompt control plane sends to a
 *  continuable child's inbox;
 *  'agent-relay' — a model-authored relay between adjacent agents. */
export type AgentMessageVia = 'parent-mediated' | 'direct-continuable' | 'agent-relay'

/** Delivery state of one message. The fold is monotone: a view only ever
 *  advances, 'unknown' is a valid final state (no delivery fact was ever
 *  observable), and nothing goes past 'queued' without an explicit backend
 *  fact. An accepted inbox is 'queued', not read or executed. */
export type AgentMessageState = 'issued' | 'queued' | 'delivered' | 'held' | 'refused' | 'expired' | 'unknown'

/** Backend-neutral identity of one agent in a team: the stable id
 *  its backend addresses it by (a Claude task/call id, a DSH durable child
 *  session id) plus the presentation facts that are actually known. */
export interface AgentIdentity {
  readonly agentId: string
  readonly parentAgentId?: string
  readonly sessionId?: string
  /** A stable name the parent can address the child by. Absent = no name
   *  addressing: disambiguate by id or hide the submit affordance. */
  readonly name?: string
  /** Creation label (the delegation's description). */
  readonly label?: string
  readonly mode?: 'one-shot' | 'continuable' | 'unknown'
  readonly status?: SubagentStatus
}

/** One observed or submitted message to an agent. */
export interface AgentMessageView {
  /** The durable inbox/session message id of the accepted message, never
   *  the local submission id (that is intentId; keep the two apart).
   *  Claude's SendMessage observation has no child inbox id: the parent tool
   *  call id (durable in the parent transcript) names it. */
  readonly messageId: string
  /** The channel-minted submission id, present when this view originated
   *  from a local composer submit. */
  readonly intentId?: string
  /** Sender: an agent id / session id, the reserved 'user', or absent when
   *  only the lane is known (a parent-lane observation renders as the
   *  parent). */
  readonly from?: string
  /** Target: an agent id / session id, or the name the parent was asked to
   *  address (Claude parent-mediated, before resolution). */
  readonly to?: string
  readonly via: AgentMessageVia
  readonly text: string
  readonly state: AgentMessageState
  /** Back-reference to the fact this view came from: a parent tool call id,
   *  a durable session seq, or a prompt receipt's message id. */
  readonly sourceRef?: string
  readonly observedAt: number
  /** The parent session the observation rode; absent when unknown. */
  readonly parentSessionId?: string
}

/** One composer submission to an agent. */
export interface AgentMessageSubmitInput {
  /** Stable child id (the AgentIdentity the picker chose). */
  readonly targetId: string
  /** Display name, when the transport addresses by name (Claude). */
  readonly targetName?: string
  readonly text: string
  /** Enter = 'queue'; Ctrl+Enter = 'steer' only where the control says so. */
  readonly delivery: 'queue' | 'steer'
  /** Caller cancellation before acceptance. */
  readonly signal?: AbortSignal
}

/** The stable outcome of one submission. ok means the transport accepted
 *  the message (`state` says how far it got, never past 'queued' without a
 *  backend fact). The failure reasons are the fixed vocabulary the notices
 *  render, so no raw provider error text is needed. */
export type AgentMessageSubmitResult =
  | { readonly ok: true; readonly intentId: string; readonly messageId?: string; readonly state: AgentMessageState }
  | { readonly ok: false; readonly reason: 'not-resumable' | 'unauthorized' | 'delivery-unavailable' | 'parent-unavailable' | 'target-ambiguous' | 'unavailable' | 'cancelled' | 'failed'; readonly message?: string }

/** The user→agent message capability a channel may serve. Present only
 *  when the backend has a real transport; without it the composer is not
 *  rendered. */
export interface AgentMessageControl {
  readonly via: AgentMessageVia
  /** Whether steer delivery (Ctrl+Enter) is supported here (DSH direct:
   *  yes; Claude parent-mediated is always a followup and never interrupts
   *  the parent turn). */
  readonly steer: boolean
  /** Addressable children, in roster order. Only children the transport may
   *  actually take (DSH: direct continuable catalog entries; Claude: the
   *  known subagent roster) are listed. Rejects when the backend's roster
   *  read fails, so a failed read is never mistaken for an empty roster. */
  listTargets(): Promise<readonly AgentIdentity[]>
  /** Submit one composer text. Resolves once the transport accepted it or
   *  failed with a stable reason (the draft stays with the caller). */
  submit(input: AgentMessageSubmitInput): Promise<AgentMessageSubmitResult>
  /** Observed relay facts of this session, oldest first (from → to
   *  summaries, the Messages page). Only messages with a real source: a DSH
   *  AgentMessageSource relay or a Claude SendMessage observation. */
  messages(): readonly AgentMessageView[]
}
