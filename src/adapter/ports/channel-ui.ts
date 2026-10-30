/** Host-owned in-process Channel contract. No runtime or upstream imports. */
import type { ChatRow, AgentStatus, TokenUsage, TurnUsageSummary, SessionCostByModel, SubagentCostEntry, NotificationItem, ChannelGoal, TodoPanelItem, LoadedContext, PendingMessage, ChannelSceneMetadata, SubagentState, SubagentControl, BackgroundJobState, JobControl, StagedImageInput, StagedImageHandle, ComposerImageRef, ComposerSubmission, ExternalCommandOutcome, TranscriptImage, ResumeResult, EffortOption, PermissionPresetSnapshot, PresetOption, LlmModelInfo, LlmProviderInfo, SkillInfo, CredentialStatus, AgentViewRow, AgentViewDispatchResult, BackgroundResult, RawTrajEvent, TrajectoryLane, TrajectorySource, ChannelSelection, AttachedContext, CompactionStatus, ContextOccupancy, ChannelCapabilities, ChannelCostReport, ChannelRateLimit, ChannelSessionRef, BackendModeOption, BackendChannelOption, BackendChannelInput } from './channel-view.js'
import type { SpinnerMode, ToolBackground, SessionModeSpec, JobGroupFoldMode } from './channel-display.js'
import type { LocalCommand, CommandCompletion, BalanceResult, FileCandidate, RecapOutcome } from './channel-catalog.js'
import type { AgentCapabilities } from './channel-capabilities.js'
import type { TuiRewindMode, SessionTreeData, SessionSummary, PreviewEntry, ForeignSource, ForeignSessionRow, ForeignImportOutcome } from './channel-session.js'
import type { TuiWorkspaceTarget, TuiWorkspaceCommand, TuiWorkspaceCommandResult, TuiWorkspaceEntry } from './channel-workspace.js'
import type { ProviderSetupHost, OAuthProviderStatus, OAuthSetupHost, SettingsHost, TuiSettingsSection } from './channel-settings.js'

/**
 * The public channel surface a screen renders: the full transcript and live
 * status snapshot (tokens, spinner, working activity, goals, todos, loaded
 * context) plus every action the TUI can take (submit, steer, cancel,
 * rewind, resume, model switching, …). Implementations mutate internal state
 * and bump `version` so subscribed screens re-render.
 */
export interface ChannelUi {
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
  /** Cross-backend identity of the bound session (`backendId` + the
   *  backend's own session id); follows every rebind. */
  readonly sessionRef: ChannelSessionRef
  /** What the bound backend session supports, as plain data: the UI hides
   *  commands and affordances whose capability is absent instead of letting
   *  them fail. A DSH session supports everything the TUI offers. Distinct
   *  from {@link ChannelUi.capabilities}, which describes what the current
   *  DSH agent's composition mounts (compaction, `/plan`, skills, …). */
  readonly backendCapabilities: ChannelCapabilities
  /** The session cost the backend itself reported (Claude
   *  `total_cost_usd`), or undefined when the backend reports none; the
   *  status line then falls back to its local estimate. */
  readonly costReport: ChannelCostReport | undefined
  /** Subscription usage windows the backend reported (Claude
   *  `rate_limit_event`), or undefined when it reports none. */
  readonly rateLimit: ChannelRateLimit | undefined
  /** The bound session has durable history older than the painted
   *  transcript (a compaction cut it off before a resume): "load earlier"
   *  shows even when no row is folded, and `loadOlder()` prepends it. */
  readonly olderHistory: boolean
  /** Resolved model id (from the plugin config). */
  readonly model: string
  /** Display name of the live model when a channel mapping says the id the
   *  runtime echoes is not what actually serves the request (relay channels
   *  echo the requested id back; backends/claude/modelEnv.ts resolves it
   *  from the user ANTHROPIC_*_MODEL env plus the local model-names.json).
   *  UI renders this instead of `model` when present; attribution and
   *  matching keep using `model`. */
  readonly modelDisplay: string | undefined
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
   *  than optional: the effect inventory maps over `keyof ChannelUi`, and an
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
   * `keyof ChannelUi`, and an optional member would widen that union.
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
  /** Context-aware slash completions, including plugin subcommands. */
  commandCompletions(input: string): readonly CommandCompletion[]
  /**
   * What the CURRENT agent's composition actually serves (compaction, pruning,
   * questionnaire, skills, and the route `/compact` and `/plan` take), with
   * the evidence for each fact documented in
   * `dsh-adapter/channel/capabilities.ts`.
   *
   * Resolved from live services through the agent's own preset scope chain —
   * never from a preset-id table — so a user preset that adds a service back
   * gets the full feature set with no consumer change. Consumers use it to
   * refuse-with-reason instead of failing on use, and to mark an entry whose
   * capability is missing in Help and `/` completion.
   */
  capabilities(): AgentCapabilities
  /**
   * Run a plugin-registered slash command against the live agent (DSH
   * `dsh-commands` registry): logs `command/run`/`command/done` and returns
   * the handler's result text — `''` when the handler succeeded silently,
   * `undefined` when the registry has no such command (the caller falls
   * back to sending the line to the model).
   */
  runExternalCommand(name: string, rawInput: string, images?: readonly ComposerImageRef[]): Promise<string | undefined>
  /** Detailed companion used by draft-owning composers. `undefined` means
   * the registry no longer has the command, so the draft stays untouched. */
  runExternalCommandOutcome(
    name: string,
    rawInput: string,
    images?: readonly ComposerImageRef[],
  ): Promise<ExternalCommandOutcome | undefined>
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
  subscribe: (listener: () => void) => () => void
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
  /** Switch the live agent to a persisted session, replaying its history. */
  resumeTo(sessionId: string): Promise<ResumeResult>
  /** Start a fresh conversation (`/new`): a brand-new agent + session, the
   *  transcript cleared, the resume marker forgotten. */
  newSession(): Promise<boolean>
  /** Switch the live model (`/model` picker): forks the conversation at its
   *  current end and continues it with a new agent routed to `provider`/`model`.
   *  The history replays unchanged; only the request route changes. */
  switchModel(provider: string, model: string): Promise<boolean>
  /** The live route's effort levels + adapter default for the `/effort`
   *  slider; empty `efforts` after notifying when unsupported/unavailable.
   *  `levelsFallback` is true when the ladder is the CLI-standard
   *  compatibility offer (the model row declares no tiers of its own) —
   *  the slider marks it as such instead of implying the model's list. */
  listEfforts(): Promise<{ efforts: readonly EffortOption[]; defaultEffort: string | undefined; levelsFallback?: true }>
  /** Set one effort level by id (validated against the adapter list);
   *  false + a notify when the id is not offered. Persists like the old
   *  Shift+Tab cycle (~/.dsh-tui/effort.json). */
  setEffort(id: string): Promise<boolean>
  /** Re-seat the future-sessions default reasoning effort (cordis.yml
   *  `effort` → persisted /effort choice → adapter default). The live agent
   *  is re-pinned too when its route offers the level, so a change lands on
   *  its next request. */
  setDefaultEffort(id: string | undefined): void
  /** The session mode currently in force (matched from the session log, or
   *  the last one Shift+Tab applied). */
  readonly mode: SessionModeSpec
  /** Index of `mode` in the configured cycle; 0 is the unmarked base mode. */
  readonly modeIndex: number
  /** Shift+Tab: advance to the next configured session mode. */
  cycleMode(): Promise<void>
  /** Read the official permission preset roster and current identity. */
  permissionPresets(): PermissionPresetSnapshot
  /**
   * TUI-side permission preset switch: drives the durable `permission/preset`
   * path (the same handler the command drives). Resolves true when the
   * durable identity confirms the target. Never falls through to the model.
   */
  runPermissionPreset(name: string): Promise<boolean>
  /** The preset the CURRENT session runs under (issue #8), resolved from its
   *  log at create/resume time; undefined when no roster is mounted. */
  readonly agentPreset: string | undefined
  /** Reset the visible transcript (`/clear`). */
  clear(): void
  /**
   * Re-render rows older than the current in-memory window from the session
   * log (rows beyond {@link ChannelState.rows}' cap are folded away; this
   * restores them for review). Returns the number of rows restored, 0 when
   * the whole log is already materialized.
   */
  loadOlder(): number
  /** Push a transient notification above the prompt input. Returns an
   *  early-dismiss handle (the auto-timeout still runs as the backstop). */
  notify(text: string, options?: { color?: NotificationItem['color']; timeoutMs?: number }): () => void
  /** Advertised models across every registered provider route (empty when the LLM service is absent). */
  listModels(): Promise<readonly LlmModelInfo[]>
  /** Provider display identities for the same routes (picker group labels). */
  listProviders(): Promise<readonly LlmProviderInfo[]>
  /** Drop the `/model <provider/id>` completion cache so the next `/model `
   *  refetch reflects a provider-catalog change (`/provider` add/edit/delete,
   *  OAuth sign-in/out) — the same consistency the picker's per-open refetch
   *  already provides. */
  invalidateModelCompletion(): void
  /** The live agent's full skill catalog for `/skills` (issue #204) — name,
   *  description, invocation flags and source bucket. Undefined on a failed
   *  or incomplete registry read (the picker shows an error); empty only
   *  when no registry is mounted or it genuinely holds nothing. */
  listSkills(): Promise<readonly SkillInfo[] | undefined>
  /** Safe credential metadata for `/login`; undefined without the service. */
  describeCredential(ref: string): Promise<CredentialStatus | undefined>
  /** Runtime capabilities for the `/provider` wizard, over the settings /
   *  credentials / llm seams; undefined when the composition lacks them
   *  (bare cordis.yml start without the dsh-base services). */
  providerSetup(): ProviderSetupHost | undefined
  /** OAuth sign-in states from a mounted dsh-auth-style plugin; undefined
   *  without the plugin, so `/login` renders exactly what it did before. */
  oauthProviderStatuses(): Promise<readonly OAuthProviderStatus[] | undefined>
  /** Structured `@` file completion, using the session's remote fs service. */
  listFileCandidates(query: string, options?: { signal?: AbortSignal; topK?: number }): Promise<readonly FileCandidate[]>
  /** Backward-compatible top-level/recursive listing. */
  listFiles(): Promise<readonly string[]>
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
  /** Render a multi-line local report in the transcript (`/status`,
   *  `/doctor`, …): a `local` row plus one `local-output` row per line. */
  pushLocal(title: string, lines: readonly string[]): void
  /** MCP server/tool status for /mcp: one line per server, or setup guidance. */
  mcpStatus(): string[]
  /** Write the conversation transcript to `dsh-tui-export-<ts>.md` in the
   *  session cwd; returns the written path, or null on failure. */
  exportSession(): string | null
  /** Create `AGENTS.md` in the session cwd (DSH workspace-context file);
   *  returns the path, `'exists'` when already present, or null on failure. */
  initWorkspace(): string | null
  /** Environment diagnostics for `/doctor`. */
  doctorInfo(): string[]
  /** Subagent rows for `/agents` (DSH subagent service; empty message when
   *  the service is absent). */
  listSubagents(): Promise<string[]>
}
