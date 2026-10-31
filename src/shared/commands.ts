import type { CommandCompletion, LocalCommand, LocalizedDescriptions } from './protocol/commands.js'
export type { CommandCompletion, LocalCommand, LocalizedDescriptions } from './protocol/commands.js'
/**
 * Local slash commands for dsh-tui, presented as `/name — description`.
 * The built-in set is merged with plugin-registered commands (plan/goal/…)
 * from the DSH command registry (`dsh-commands`); `runCommand` in the Chat
 * screen dispatches either kind.
 *
 * Locals win on name collisions: the merge skips a registry descriptor whose
 * name a local command already declares (`channel/skill-catalog.ts`), and the
 * Chat switch answers the local name before the registry path. `/compact` is
 * the live case — the TUI's own transaction is the primary route and the
 * official `dsh-command-compact` handler is only the fallback when the local
 * path cannot run (see `dsh-adapter/channel/capabilities.ts`).
 */

import { tOr } from './i18n.js'

/** One child in a slash-command tree contributed by a local feature/plugin. */
export interface CommandCompletionNode {
  name: string
  aliases?: readonly string[]
  description: string
  descriptions?: LocalizedDescriptions
  tag?: string
  /** Optional i18n key; plugin nodes normally rely on fallback text. */
  descriptionKey?: string
}

export type CommandChildren = (canonicalPath: readonly string[]) => readonly CommandCompletionNode[]

/**
 * Whether a value can occupy one command-completion token. Keep this aligned
 * with the grammar accepted by {@link completeCommands}; callers that need an
 * empty prefix handle that case separately.
 */
export function isCommandCompletionToken(value: string): boolean {
  return /^[a-z0-9_.:\/-]+$/iu.test(value)
}

/**
 * The built-in slash commands (name + description pairs). Plugin-registered
 * commands merge in at runtime; locals win on name collisions.
 */
export const LOCAL_COMMANDS: LocalCommand[] = [
  { name: 'new', description: 'Start a new conversation' },
  { name: 'resume', description: 'Continue a saved session' },
  { name: 'session', description: 'List saved sessions' },
  { name: 'rename', description: 'Rename the current session' },
  { name: 'export', description: 'Export the current session' },
  { name: 'compact', description: 'Summarize earlier turns to free context space' },
  { name: 'model', description: 'Show or switch the active model' },
  { name: 'effort', description: 'Adjust the reasoning effort' },
  { name: 'permission', description: 'Show or switch the permission mode' },
  { name: 'provider', description: 'Manage LLM providers and API endpoints' },
  { name: 'auth', description: 'Manage provider authentication' },
  { name: 'thinking', description: 'Toggle extended thinking display' },
  { name: 'mcp', description: 'Show MCP server status' },
  { name: 'status', description: 'Show session context, token usage and cost' },
  { name: 'doctor', description: 'Run environment checks' },
  { name: 'help', description: 'Show shortcuts and commands' },
  { name: 'exit', description: 'Exit dsh-tui' },
]

/** The short list shown before a command name is typed. */
const DEFAULT_SLASH_COMMAND_NAMES = [
  'new', 'resume', 'session', 'model', 'effort', 'permission', 'provider', 'auth', 'help', 'exit',
] as const

/** Keep the active backend's command descriptors and omit unavailable names. */
function defaultSlashCommands(commands: readonly LocalCommand[]): LocalCommand[] {
  return DEFAULT_SLASH_COMMAND_NAMES.flatMap(name => {
    const command = commands.find(candidate => candidate.name === name)
    return command === undefined ? [] : [command]
  })
}

/**
 * Hidden slash commands: intentionally not exposed in the `/` suggestion
 * menu or Help, but still recognized as local commands when typed. They are
 * kept out of `LOCAL_COMMANDS` so `completeCommands` never
 * surface them; dispatch recognizes them via {@link HIDDEN_COMMAND_NAMES}.
 */
export const HIDDEN_COMMANDS: readonly LocalCommand[] = []

/** Names of hidden commands, for fast dispatch/lookup. */
export const HIDDEN_COMMAND_NAMES: ReadonlySet<string> = new Set(
  HIDDEN_COMMANDS.map(command => command.name),
)

/**
 * Whether the input names a hidden command (same slash-optional trimming
 * rules as {@link isLocalCommandName}).
 */
export function isHiddenCommandName(input: string): boolean {
  const name = input.replace(/^\//, '').trim()
  return HIDDEN_COMMAND_NAMES.has(name)
}

/** Only this hidden command may bypass active-turn steering. */
export function isImmediateHiddenCommandName(name: string): boolean {
  return false
}

export const LOCAL_COMMAND_CHILDREN: Readonly<Record<string, readonly CommandCompletionNode[]>> = {
  session: [{ name: 'list', description: 'List saved sessions' }],
}

/** The session command is a short alias for the saved-session list. */
export function resolveLocalCommandPath(
  name: string,
  rawInput: string,
): { name: string; rawInput: string } | { usage: 'session' } {
  if (name !== 'session') return { name, rawInput }
  return rawInput.trim() === '' || rawInput.trim() === 'list'
    ? { name: 'resume', rawInput: '' }
    : { usage: 'session' }
}

/** Resolve the English command description, preserving plugin fallback text. */
export function localizedDescription(command: LocalCommand & { descriptionKey?: string }): string {
  return command.descriptions?.en ?? tOr(command.descriptionKey ?? `cmd-desc-${command.name}`, command.description)
}

/**
 * Parse a slash-command line into its name and the verbatim input following
 * the name (separator whitespace included) — the same split the DSH command
 * registry uses, so `/plan off` dispatches `plan` with ` off`.
 *
 * @param line - Complete candidate command line.
 * @returns The parsed name and raw input, or `undefined` when the line is
 *   not a command.
 */
export function parseCommandName(
  line: string,
): { name: string; rawInput: string } | undefined {
  const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/.exec(line)
  if (match === null) return undefined
  return { name: match[1], rawInput: line.slice(match[0].length) }
}

/**
 * Whether the input names a local command. Local commands must never be sent
 * to the model when typed alone; trailing whitespace is legal.
 * @param input - Candidate command line (slash optional).
 * @param list - Command list to match against; defaults to LOCAL_COMMANDS.
 * @returns True when the trimmed input names a command in `list`.
 */
export function isLocalCommandName(
  input: string,
  list: readonly LocalCommand[] = LOCAL_COMMANDS,
): boolean {
  // Trailing whitespace is legal (Tab completion leaves a space after the
  // name so the user can type arguments).
  const name = input.replace(/^\//, '').trim()
  return HIDDEN_COMMAND_NAMES.has(name) || list.some(command => command.name === name)
}

/**
 * Complete an arbitrary slash-command path. Root commands come from the
 * ordinary DSH/TUI catalog; each resolved token asks the caller for its
 * children, so PromptInput never needs feature- or plugin-specific cases.
 */
export function completeCommands(
  input: string,
  roots: readonly LocalCommand[] = LOCAL_COMMANDS,
  children: CommandChildren = () => [],
): CommandCompletion[] {
  if (!input.startsWith('/') || /[\r\n]/u.test(input)) return []
  const body = input.slice(1)
  // Token charset includes `. : /` so provider/model specs (e.g.
  // `deepseek/deepseek-flash`, `openai/gpt-4.1`) survive as ONE token —
  // the /model completion matches its candidates against the whole spec.
  if (!body.split(/[\t ]+/u).every(token => token === '' || isCommandCompletionToken(token))) return []
  const trailingSeparator = /[\t ]$/u.test(body)
  const tokens = body.split(/[\t ]+/u)
  const prefix = trailingSeparator ? '' : (tokens.pop() ?? '')
  if (trailingSeparator && tokens.at(-1) === '') tokens.pop()

  const canonicalPath: string[] = []
  let candidates: readonly CommandCompletionNode[] = roots
  for (const token of tokens) {
    const resolved = resolveCompletionNode(candidates, token)
    if (resolved === undefined) return []
    canonicalPath.push(resolved.name)
    candidates = children(canonicalPath)
  }

  const normalizedPrefix = prefix.toLowerCase()
  return candidates.flatMap(candidate => {
    const completionToken = matchingCompletionToken(candidate, normalizedPrefix)
    if (completionToken === undefined || !isCommandCompletionToken(completionToken)) return []
    const path = [...tokens, completionToken]
    const commandLine = `/${path.join(' ')}`
    return [{
      name: path.join(' '),
      description: candidate.description,
      ...(candidate.descriptions === undefined ? {} : { descriptions: candidate.descriptions }),
      ...(candidate.descriptionKey === undefined ? {} : { descriptionKey: candidate.descriptionKey }),
      ...(candidate.tag === undefined && candidate.aliases?.length
        ? { tag: `aliases: ${candidate.aliases.join(', ')}` }
        : candidate.tag === undefined ? {} : { tag: candidate.tag }),
      replacement: `${commandLine} `,
      commandLine,
    }]
  })
}

/** Apply the compact bare-slash menu without changing generic completion. */
export function completeTuiCommands(
  input: string,
  roots: readonly LocalCommand[],
  children?: CommandChildren,
): CommandCompletion[] {
  return completeCommands(input, input === '/' ? defaultSlashCommands(roots) : roots, children)
}

function resolveCompletionNode(
  candidates: readonly CommandCompletionNode[],
  token: string,
): CommandCompletionNode | undefined {
  const normalized = token.toLowerCase()
  return candidates.find(candidate =>
    candidate.name.toLowerCase() === normalized
    || candidate.aliases?.some(alias => alias.toLowerCase() === normalized))
}

function matchingCompletionToken(candidate: CommandCompletionNode, prefix: string): string | undefined {
  if (candidate.name.toLowerCase().startsWith(prefix)) return candidate.name
  return candidate.aliases?.find(alias => alias.toLowerCase().startsWith(prefix))
}
