import type { AgentCapabilities } from './channel-capabilities.js'
import type { CommandCompletion, FileCandidate } from './channel-catalog.js'
import type { ComposerImageRef } from './composer-view.js'
import type { SkillInfo } from './model-view.js'
import type { ExternalCommandOutcome, NotificationItem } from './session-view.js'

/** ClientServices: client-owned operations. */
export interface ClientServices {
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
  subscribe: (listener: () => void) => () => void
  /** Push a transient notification above the prompt input. Returns an
   *  early-dismiss handle (the auto-timeout still runs as the backstop). */
  notify(text: string, options?: { color?: NotificationItem['color']; timeoutMs?: number }): () => void
  /** The live agent's full skill catalog for `/skills` (issue #204) — name,
   *  description, invocation flags and source bucket. Undefined on a failed
   *  or incomplete registry read (the picker shows an error); empty only
   *  when no registry is mounted or it genuinely holds nothing. */
  listSkills(): Promise<readonly SkillInfo[] | undefined>
  /** Structured `@` file completion, using the session's remote fs service. */
  listFileCandidates(query: string, options?: { signal?: AbortSignal; topK?: number }): Promise<readonly FileCandidate[]>
  /** Backward-compatible top-level/recursive listing. */
  listFiles(): Promise<readonly string[]>
  /** Render a multi-line local report in the transcript (`/status`,
   *  `/doctor`, …): a `local` row plus one `local-output` row per line. */
  pushLocal(title: string, lines: readonly string[]): void
  /** MCP server/tool status for /mcp: one line per server, or setup guidance. */
  mcpStatus(): string[]
  /** Create `AGENTS.md` in the session cwd (DSH workspace-context file);
   *  returns the path, `'exists'` when already present, or null on failure. */
  initWorkspace(): string | null
  /** Environment diagnostics for `/doctor`. */
  doctorInfo(): string[]
  /** Subagent rows for `/agents` (DSH subagent service; empty message when
   *  the service is absent). */
  listSubagents(): Promise<string[]>
}
