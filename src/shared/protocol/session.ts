

/**
 * One working-activity line value a backend publishes for its own session.
 * Same shape as the DSH `dsh-working-activity` plugin's session projection,
 * so a backend without that plugin (Claude folds its own) can serve the same
 * working line. Consumers narrow with `asActivityView` before rendering, so
 * a malformed value is dropped rather than shown half-formed.
 */
export interface WorkingActivityView {
  /** Which phase the line is in; `idle` means "render nothing". */
  readonly phase: 'idle' | 'waiting' | 'thinking' | 'tool' | 'done'
  /** The line as the backend rendered it at `updatedAt`. */
  readonly line: string
  /** Whether `line` counts elapsed time (this port publishes settled copy,
   *  so a backend-authored value is `false` unless it re-renders the line). */
  readonly live: boolean
  /** Tool action verb, when the line describes a running tool. */
  readonly label?: string
  /** Tool detail fragment (path / command / pattern), when there is one. */
  readonly detail?: string
  /** The playful phrase or `⏵` self-narration currently shown, when any. */
  readonly phrase?: string
  /** Tools completed in the current turn. */
  readonly toolCount: number
  /** Wall clock the current phase began. */
  readonly phaseStartedAt: number
  /** Wall clock the current turn began (0 when no turn has started). */
  readonly turnStartedAt: number
  /** Timestamp of the last folded event (how fresh the value is). */
  readonly updatedAt: number
  /** Language the line was rendered in. */
  readonly lang: 'zh' | 'en'
}

/** A transient status message shown above the prompt input. */
export interface NotificationItem {
  id: number
  text: string
  /** Theme color key; defaults to dim. */
  color?: 'error' | 'warning' | 'success'
  /** Auto-dismiss after this many ms (default 4000); 0 = sticky, removed
   *  only through the early-dismiss handle. */
  timeoutMs: number
}

/**
 * The session's in-flight compaction (`/compact`, or the automatic pressure
 * compaction at a turn boundary), as the status row above the prompt renders
 * it. The host exposes no proportional progress: a compaction is one model
 * call between two durable session events, so this carries only what is
 * observable — when the bracket opened, whether that call has started
 * producing output, how much it has produced, and whether this process may
 * abort it.
 */
export interface CompactionStatus {
  /** Wall-clock ms when the compaction bracket opened. */
  readonly startedAt: number
  /** `prefill` until the summarizer's first output chunk: replaying the
   *  conversation prefix is a long silent phase with nothing to count.
   *  `summary` once output is streaming. */
  readonly phase: 'prefill' | 'summary'
  /** Output chars streamed by the compaction model call (see `phase`). */
  readonly outputChars: number
  /** True only for a compaction this process started, so only it may abort. */
  readonly cancellable: boolean
}

/**
 * Durable same-session goal projection surfaced on the channel (see
 * {@link Channel['goal']}). Mirrors the goal domain's `GoalSnapshot` +
 * replay counters; declared locally so the UI needs no dsh-goal dependency.
 */
export interface ChannelGoal {
  id: string
  revision: number
  objective: string
  phase: 'active' | 'paused' | 'blocked' | 'complete'
  /** Total admitted goal-round cap. */
  maxGoalRounds: number
  /** Highest admitted continuation round so far. */
  roundsStarted: number
  /** Present exactly while `phase` is `blocked`. */
  blockedReason?: { code: string; message: string }
}

/** One entry of the latest todo-list snapshot (mirrors dsh-tool-todo's
 *  `TodoItem`; declared locally so the adapter needn't depend on that plugin). */
export interface TodoPanelItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/**
 * Snapshot of everything a fresh conversation for the current agent will
 * load: the assembled system prompt (ordered sections, dynamic context,
 * tools), the workspace instruction files baseline discovery would inject,
 * and the skill catalog. Declared locally so screens and helpers consume a
 * self-contained contract instead of the dsh-system-prompt/dsh-skill types.
 */
export interface LoadedContext {
  /** Ordered system-prompt sections after strict variable interpolation. */
  readonly sections: readonly LoadedContextEntry[]
  /** Dynamic context contributions (runtime snapshot parts). */
  readonly contexts: readonly LoadedContextEntry[]
  /** Workspace instruction files (AGENTS.md-family) discovered for the cwd. */
  readonly files: readonly LoadedContextFile[]
  /** Model-invocable skills, when the skill registry is mounted. */
  readonly skills: readonly LoadedContextSkill[]
  /** Model-visible tools in assembly order. */
  readonly tools: readonly LoadedContextTool[]
}

/** One named prompt contribution with its model-visible text. */
export interface LoadedContextEntry {
  /** Provider-declared name (e.g. `harness:identity`, `deployment:persona`). */
  readonly name: string
  /** The interpolated text the model receives for this entry. */
  readonly text: string
}

/** One discovered workspace instruction file (AGENTS.md-family). */
export interface LoadedContextFile {
  /** Model-facing path (e.g. `./AGENTS.md`). */
  readonly displayPath: string
}

/** One model-invocable skill from the skill registry. */
export interface LoadedContextSkill {
  readonly name: string
  readonly description: string
}

/** One model-visible tool from the prompt assembly. */
export interface LoadedContextTool {
  readonly name: string
  readonly description: string
}

/** UI-safe projection of one settled DSH registry command. Keeping the
 * result kind across the adapter boundary lets the composer retain a
 * rejected image draft instead of treating the error text as success. */
export type ExternalCommandOutcome =
  | { readonly kind: 'success'; readonly text: string; readonly consumeDraft: true }
  | { readonly kind: 'error'; readonly text: string; readonly consumeDraft: boolean }

/** The observable outcome of adopting a persisted session. */
export type ResumeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'working' }
  | { readonly ok: false; readonly reason: 'unavailable' }
  | { readonly ok: false; readonly reason: 'cancelled' }
  | { readonly ok: false; readonly reason: 'failed'; readonly error: string }
  /**
   * Another TUI process currently has this session mounted. Two processes
   * driving one session would interleave writes into a single append-only
   * transcript, so the mount is refused rather than raced. `pid` names the
   * holder so a surface can say which terminal owns it; the claim clears on
   * its own once that process exits (see `sessionMounts`).
   */
  | { readonly ok: false; readonly reason: 'occupied'; readonly pid: number }

/** One row in the agent view list. */
export interface AgentViewRow {
  /** Session id — the attach/dispatch target. */
  readonly id: string
  /** Display title (session title, or a fallback from the prompt/cwd). */
  readonly title: string
  /** Absolute working directory the session runs in. */
  readonly cwd: string
  /** One-line activity summary derived from the session's recent output. */
  readonly summary: string
  readonly status: AgentViewStatus
  /** True when an agent for this session is alive in THIS process (✻ vs ∙). */
  readonly live: boolean
  /** True when this is the session the TUI terminal is attached to. */
  readonly current: boolean
  /** Unix epoch milliseconds when the session was created. */
  readonly createdAt: number
  /** Unix epoch milliseconds of the session's latest activity. */
  readonly updatedAt: number
}

/**
 * One session's state in the agent view.
 * State vocabulary:
 * `working` — a turn is running; `needs-input` — an approval request is
 * parked for this agent; `idle` — live and waiting for the next prompt;
 * `completed` — a live agent whose last turn ended (task finished, waiting);
 * `failed` — the last turn ended with an error; `stopped` — the session's
 * process is gone (persisted only).
 */
export type AgentViewStatus =
  | 'working'
  | 'needs-input'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'stopped'

/** The observable outcome of dispatching a new background session. */
export type AgentViewDispatchResult =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly reason: 'unavailable' }
  | { readonly ok: false; readonly reason: 'failed'; readonly error: string }

/** The observable outcome of backgrounding the attached session. */
export type BackgroundResult =
  | { readonly ok: true; readonly backgroundedSessionId: string }
  | { readonly ok: false }

/** A backend-reported (or locally estimated) session cost. */
export interface ChannelCostReport {
  readonly currency: string
  readonly amount: number
  readonly source: 'backend' | 'estimate'
}

export type AgentStatus = 'idle' | 'running'
export interface RawTrajEvent { readonly type: string; readonly seq: number; readonly time: number; readonly data: unknown }

/**
 * What the channel's trajectory source reports. A composition either mounted
 * a trajectory source or it did not, and that is decided by what was mounted
 * (the backend-neutral core mounts the AgentEvent fold; the DSH extension
 * replaces it with its raw history), never by a backendId lookup.
 *
 *   'supported'    a source is mounted and has events (the DSH raw view;
 *                  Claude via the AgentEvent fold);
 *   'empty'        a source is mounted, the session just has no events yet;
 *                  the only state that may promise "data once turns happen";
 *   'unsupported'  no source is mounted at all: surfaces say so instead of
 *                  posing as an empty session, promise no future data, and
 *                  keep the fullscreen outlet disabled.
 */
export type TrajectorySource = 'supported' | 'empty' | 'unsupported'

/**
 * One trajectory drilldown lane (cross-agent drilldown): a subagent whose
 * child-lane events the mounted source folded into their own raw-event log.
 * The scope filter (当前 Agent / 父回合 / 全部后代) refolds those logs on
 * demand; a source that attributes no lanes reports none and the filter is
 * not offered.
 */
export interface TrajectoryLane {
  /** The subagent's id (the lane log's lookup key). */
  readonly agentId: string
  /** The delegating tool call that anchors this lane (the lane router's key). */
  readonly callId?: string
  /** The subagent's description, when the start event carried one. */
  readonly label?: string
  readonly model?: string
  /** The lane this agent was spawned from (undefined = the main session). */
  readonly parentAgentId?: string
  /** Spawn nesting: 1 = spawned by the main loop. */
  readonly depth: number
}

/**
 * The ONE context-occupancy reading every occupancy surface shares: the
 * footer's `ctx` field and its hover detail, the segmented context bar, the
 * working-activity line's `⚠ ctx N%` prefix, `/tokens` + `/status`, and the
 * context-low warning.
 *
 * It is deliberately separate from the last request's billed usage, which stays
 * the source for cache-hit-rate and cost readouts: "what the last request cost"
 * and "how full the window is now" are different questions (see
 * `dsh-adapter/context-occupancy.ts`).
 */
export interface ContextOccupancy {
  /** Tokens the next request would occupy. */
  readonly usedTokens: number
  /** Window to divide by; `undefined` when no route advertised a capacity. */
  readonly contextWindow: number | undefined
  /**
   * Which source answered: `projection` is DSH's own `contextPressure`
   * projection (the number the Web UI shows); `sample` is this TUI's fallback,
   * the last settled request's billed usage, used only when the composition
   * mounts no token meter.
   */
  readonly source: 'projection' | 'sample'
}
