import type { LocalCommand } from '../../shared/protocol/commands.js'
import type { JobGroupFoldMode, SessionModeSpec, SpinnerMode, ToolBackground } from '../../shared/protocol/display.js'
import type { ChannelSelection, PendingMessage } from '../../shared/protocol/composer.js'
import type { BackgroundJobState, JobControl } from '../../shared/protocol/jobs.js'
import type { AgentStatus, ChannelCostReport, ChannelGoal, CompactionStatus, ContextOccupancy, LoadedContext, NotificationItem, TodoPanelItem } from '../../shared/protocol/session.js'
import type { SubagentControl, SubagentState } from '../../shared/protocol/subagents.js'
import type { ChatRow, SessionCostByModel, SubagentCostEntry, TokenUsage, TurnUsageSummary } from '../../shared/protocol/transcript.js'

/** ClientSnapshot: client-owned read state. */
export interface ClientSnapshot {
  /** Monotonic version — bump on every mutation so screens can re-render. */
  readonly version: number
  readonly rows: readonly ChatRow[]
  /** Live editor selection from the IDE channel (undefined = no IDE / no
   *  selection / link dropped). Protocol-2 pushes carry the editor buffer's
   *  own text; the submit path attaches it verbatim and only falls back to
   *  reading the file from disk for protocol-1 pushes. */
  readonly selection: ChannelSelection | undefined
  readonly status: AgentStatus | 'starting' | 'disposed'
  readonly sessionTitle: string
  /** Per-session accent color name (`/color`), '' when unset — persisted via
   *  a `session/color` log event so it survives resume/rewind. Renders as
   *  the prompt-input border + session label chip accent (cc/sessionColors). */
  readonly sessionColor: string
  readonly agentId: string
  /** Identity of the session behind the bound agent. Read by session-scoped
   *  consumers — the activity projection is keyed by session, and the two ids
   *  are only conventionally equal (both are minted as a `SessionId`), so the
   *  session must be nameable on its own rather than inferred from the agent. */
  readonly sessionId: string
  /** TUI-owned generation that changes on every live Agent rebind. */
  readonly agentBindingGeneration: number
  /** The session cost the backend itself reported (Claude
   *  `total_cost_usd`), or undefined when the backend reports none; the
   *  status line then falls back to its local estimate. */
  readonly costReport: ChannelCostReport | undefined
  /** The bound session has durable history older than the painted
   *  transcript (a compaction cut it off before a resume): "load earlier"
   *  shows even when no row is folded, and `loadOlder()` prepends it. */
  readonly olderHistory: boolean
  /** Resolved model id (from the plugin config). */
  readonly model: string
  /** Provider route of the live agent. */
  readonly provider: string
  /** Raw cordis.yml `provider` key (undefined when unset) — the boot-time
   *  pin `/reload` must never override. */
  readonly configuredProvider: string | undefined
  /** Raw cordis.yml `model` key (undefined when unset). */
  readonly configuredModel: string | undefined
  /** Explicit cordis.yml `preset` (undefined = roster default wins) — `/reload`
   *  must not override a static deployment choice. */
  readonly configuredPreset: string | undefined
  /** Running token totals across the session's assistant messages. */
  readonly tokens: TokenUsage
  /** 本会话主会话用量按模型分桶（费用估算输入）。与 `tokens` 并行累计，
   *  既有 `tokens` 语义与显示不变；会话中途换模型时历史用量留在原模型桶。 */
  readonly mainCost: SessionCostByModel
  /** 子代理 durable 用量按 (provider, model) 分桶快照（费用估算输入）。 */
  readonly subagentCost: readonly SubagentCostEntry[]
  /** Working directory of the session. */
  readonly cwd: string
  /** Human-facing cwd (remote POSIX path/URI instead of a host alias). */
  readonly displayCwd: string
  /** Current git branch, when the cwd is inside a git worktree. */
  readonly gitBranch: string | undefined
  /** True between turn/start and turn/end — drives the working spinner. */
  readonly working: boolean
  /** In-flight compaction of this session's history, or undefined when none
   *  is running (see {@link CompactionStatus}). Required-and-undefined rather
   *  than optional: the effect inventory maps over `keyof Client`, and an
   *  optional member widens that key union with `undefined`, which breaks the
   *  `Record` constraint on the inventory itself. */
  readonly compaction: CompactionStatus | undefined
  /** True while a user-requested abort (Ctrl+C/Esc interrupt) has not yet
   *  converged — no turn/start or turn/end has retired the aborted turn.
   *  Chat uses it so a repeated Ctrl+C during a stuck abort force-exits. */
  readonly cancelPending: boolean
  /** Which phase the spinner should present while working. */
  readonly spinnerMode: SpinnerMode
  /** Chars streamed as text this turn (feeds the spinner token counter). */
  readonly responseChars: number
  /** Number of tool calls still in flight this turn. */
  readonly activeToolCount: number
  /** Wall-clock ms of turn/start (spinner elapsed timer). */
  readonly turnStart: number
  /** Last user prompt text (sticky header + statusline). */
  readonly lastUserText: string
  /** Transient notifications, newest last. */
  readonly notifications: readonly NotificationItem[]
  /** Adapter-advertised context capacity for the model route, when known. */
  readonly contextWindow: number | undefined
  /** Reasoning effort of the latest request header, when the adapter sets one. */
  readonly reasoningEffort: string | undefined
  /** The live route's reasoning-effort level ids, low → high (the last entry
   *  is the top tier). Consumed by top-tier-triggered UI (effort ignition). */
  readonly effortLevels: readonly string[] | undefined
  /** Usage of the most recent request (context share + cache hits come from
   *  this, not the running totals — each request's input IS the context).
   *  `at` is the producing message's event time, so readouts that quote
   *  this request can say when it was measured. */
  readonly lastUsage:
    | { input: number; output: number; cacheRead: number; cacheWrite: number; at: number }
    | undefined
  /** Ledger of the most recently ended turn: per-turn usage aggregate,
   *  retry count, span, model/effort. Kept until the next turn ends, so the
   *  footer's turn mini-summary can read it while the next turn runs without
   *  mixing the two. Undefined before any turn ended. */
  readonly turnUsage: TurnUsageSummary | undefined
  /**
   * Context occupancy — the ONE source of truth for the footer's `ctx` field,
   * the segmented context bar, the working-activity line's `⚠ ctx N%` prefix,
   * `/tokens` + `/status`, and the context-low warning. Read from DSH's own
   * `contextPressure` session projection (`projectedTokens ?? pressureTokens`,
   * the same number the Web UI shows) and refreshed by that projection's change
   * feed — never by a per-render fold.
   *
   * `undefined` only before anything is known: no request yet AND no meter (a
   * bare `cordis.yml` composition). {@link ContextOccupancy.source} says which
   * path answered; see `dsh-adapter/context-occupancy.ts` for the deliberate
   * divergence from the official "render nothing" behavior.
   *
   * Required-and-undefined rather than optional, matching `compaction`: the
   * effect inventory in `adapter/channel/ui-policy.ts` maps over
   * `keyof Client`, and an optional member would widen that union.
   */
  readonly contextOccupancy: ContextOccupancy | undefined
  /** Output tokens per second of the current/last turn's response, when known. */
  readonly tps: number | undefined
  /** Per-turn tps samples (sparkline history), oldest first. */
  readonly tpsSamples: readonly { tps: number; at: number }[]
  /** Edit/Write diff presentation preference (`auto`/`split`/`unified`). */
  readonly diffLayout: 'auto' | 'split' | 'unified'
  /** Thinking-block display (`preview` = 2-3 line live stream + fold per
   *  step; `full` = expanded until turn end). */
  readonly thinkingFold: 'preview' | 'full'
  /** Grouping/folding of runs of consecutive background-job cards (settings
   *  `dsh-tui.jobGroupFold`): `auto` folds a settled run of 3+ into its
   *  summary line, `always` folds any run of 2+, `never` never folds on its
   *  own (a header click still folds a single run). */
  readonly jobGroupFold: JobGroupFoldMode
  /** Live tool-card background treatment. */
  readonly toolBackground: ToolBackground
  /** Whether the session-name chip shows on the prompt top border's right
   *  side (settings `dsh-tui.promptSessionLabel`; off by default). */
  readonly promptSessionLabel: boolean
  /** Whether the fullscreen draft editor is enabled (settings
   *  `dsh-tui.expandEditor`; on by default) — gates the ⛶ affordance and
   *  the expandEditor shortcut. */
  readonly expandEditor: boolean
  /**
   * Current same-session goal projection, when a goal exists. Derived live
   * from the durable goal events in the session log — top-level
   * `goal/change` snapshots (every goal mutation appends one) plus the
   * goal-sourced continuation rounds that advance the counter — so this
   * snapshot tracks create/edit/pause/resume/complete/block/clear in real
   * time and replays correctly on resume/rewind.
   */
  readonly goal: ChannelGoal | undefined
  /**
   * Latest todo-list snapshot (`todo/write` whole-list event, last write
   * wins). Log-only UI state, updated live and on replay.
   */
  readonly todos: readonly TodoPanelItem[]
  /**
   * Snapshot of the context a fresh conversation for this agent will load
   * (system prompt sections, dynamic context, workspace instructions, skill
   * catalog, tools), computed at boot and on every agent swap. `undefined`
   * while loading or when the snapshot could not be assembled — the startup
   * panel stays hidden until it lands.
   */
  readonly loadedContext: LoadedContext | undefined
  /**
   * Messages submitted while the model was working and not yet claimed by a
   * turn (`steer` → next step boundary of the running turn, `followup` →
   * after the turn ends). Driven by agent inbox events.
   */
  readonly pending: readonly PendingMessage[]
  /**
   * Effective slash commands: built-in locals plus plugin-registered
   * commands (plan/goal/…) merged from the DSH command registry. The
   * registry is the source of truth for external names — a plugin shadows
   * nothing here; locals win on name collisions.
   */
  readonly commandList: readonly LocalCommand[]
  /**
   * Plugin-registered full-screen scene currently replacing the conversation
   * (the `dsh-tui-scenes` runtime), if any. The chat screen renders its
   * component INSTEAD of the transcript — the same whole-terminal treatment
   * the trajectory scene gets — and hands it the keyboard; `undefined`
   * renders the conversation normally.
   */
  /** Estimated context segments by content type (pi-nano-context style bar). */
  readonly contextSegments: {
    system: number
    prompt: number
    assistant: number
    thinking: number
    tools: number
  }
  /** Active subagents spawned by the current session. */
  readonly subagents: readonly SubagentState[]
  /** Native control operations; unavailable providers safely return false. */
  readonly subagentControl: SubagentControl
  /**
   * Background jobs of the current session (`run_in_background` tool work),
   * live-tracked from the harness job registry. Empty when the composition
   * has no jobs service. Drives the `/jobs` panel, transcript job cards and
   * the status-line chip.
   */
  readonly backgroundJobs: readonly BackgroundJobState[]
  /** Cancellation of a background job with the owning agent's authority. */
  readonly jobControl: JobControl
  /** The session mode currently in force (matched from the session log, or
   *  the last one Shift+Tab applied). */
  readonly mode: SessionModeSpec
  /** Index of `mode` in the configured cycle; 0 is the unmarked base mode. */
  readonly modeIndex: number
  /** The preset the CURRENT session runs under (issue #8), resolved from its
   *  log at create/resume time; undefined when no roster is mounted. */
  readonly agentPreset: string | undefined
}
