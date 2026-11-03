import type { SubagentRow } from '../../../shared/protocol/subagents.js'
import type { ToolCallView, ToolFileDiff, ToolResultView, ToolRow } from '../../../shared/protocol/transcript.js'
import { t } from '../../../shared/i18n.js'
import { toolDisplayName } from '../../../shared/platform/tool-name.js'

export type EntryStatus = 'running' | 'ok' | 'error'

/** Visual family of a tool/activity row. */
export type EntryTone = 'exec' | 'read' | 'write' | 'web' | 'task' | 'muted'

export type BodyTone = 'plain' | 'add' | 'del' | 'dim' | 'error' | 'path'

/** One rendered body line. The view layer owns colors and wrapping. */
export type BodyLine = {
  readonly text: string
  readonly tone: BodyTone
}

/** A collapsed body payload; `hiddenLines` is what expansion would reveal. */
export type EntryBody = {
  readonly lines: readonly BodyLine[]
  readonly hiddenLines: number
}

/** Common presentation model for tool calls, jobs and subagents. */
export type Entry = {
  readonly tone: EntryTone
  readonly mode: 'inline' | 'block'
  readonly title: string
  /** Recessive text after the title: duration, exit code, match count, … */
  readonly meta?: string
  readonly status: EntryStatus
  /** Shown while running, before the title has enough information. */
  readonly pending: string
  readonly elapsedMs?: number
  readonly durationMs?: number
  readonly startedAt?: number
  readonly body?: EntryBody
  readonly expandable: boolean
  /** Full error text; the collapsed row shows only its first line. */
  readonly error?: string
}

export type EntryOptions = {
  /** Ctrl+O or a row click: show the complete body instead of the preview. */
  readonly expanded: boolean
}

const INLINE_GENERIC_BODY_LINES = 4
const EXPANDED_BODY_LINES = 400
const SHELL_BODY_LINES = 4
const CODE_BODY_LINES = 6
const DIFF_BODY_LINES = 6

const SHELL_NAMES = new Set(['bash', 'bashpersistent', 'sh', 'shell', 'terminal', 'powershell', 'pwsh'])
const READ_NAMES = new Set(['read', 'read_file', 'readfile'])
const LIST_NAMES = new Set(['list', 'list_dir', 'listdir', 'ls'])
const SEARCH_NAMES = new Set(['glob', 'grep', 'search', 'search_files', 'file_search'])
const WRITE_NAMES = new Set(['write', 'write_file', 'writefile'])
const EDIT_NAMES = new Set(['edit', 'multiedit', 'notebookedit', 'apply_patch', 'patch', 'str_replace_editor'])
const WEB_FETCH_NAMES = new Set(['web_fetch', 'webfetch', 'fetch'])
const WEB_SEARCH_NAMES = new Set(['web_search', 'websearch'])
const TODO_NAMES = new Set(['todo_write', 'todowrite'])
const QUESTION_NAMES = new Set(['question', 'ask_user', 'ask_user_question'])

type ToolKind =
  | 'shell'
  | 'read'
  | 'list'
  | 'search'
  | 'write'
  | 'edit'
  | 'webfetch'
  | 'websearch'
  | 'job'
  | 'todo'
  | 'question'
  | 'generic'

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

export function toolKindOf(name: string): ToolKind {
  const normalized = normalizeName(name)
  if (SHELL_NAMES.has(normalized)) return 'shell'
  if (READ_NAMES.has(normalized)) return 'read'
  if (LIST_NAMES.has(normalized)) return 'list'
  if (SEARCH_NAMES.has(normalized)) return 'search'
  if (WRITE_NAMES.has(normalized)) return 'write'
  if (EDIT_NAMES.has(normalized)) return 'edit'
  if (WEB_FETCH_NAMES.has(normalized)) return 'webfetch'
  if (WEB_SEARCH_NAMES.has(normalized)) return 'websearch'
  if (normalized.startsWith('job_')) return 'job'
  if (TODO_NAMES.has(normalized)) return 'todo'
  if (QUESTION_NAMES.has(normalized)) return 'question'
  return 'generic'
}

/** True when the tool renders as a bordered block (shell/write/edit). */
export function isBlockToolName(name: string): boolean {
  const kind = toolKindOf(name)
  return kind === 'shell' || kind === 'write' || kind === 'edit'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseArgs(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined || raw === '') return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** First primitive argument, used as a fallback title for unknown tools. */
function primitiveSummary(args: Record<string, unknown> | undefined): string | undefined {
  if (args === undefined) return undefined
  const parts: string[] = []
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${String(value)}`)
    }
    if (parts.length >= 4) break
  }
  return parts.length === 0 ? undefined : parts.join(', ')
}

function linesOf(text: string | undefined): string[] {
  if (text === undefined) return []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function tail(text: string | undefined, maximum: number, dropBlank = false): { lines: readonly BodyLine[]; hidden: number } {
  const all = (dropBlank ? linesOf(text).filter(line => line.trim() !== '') : linesOf(text))
  if (all.length <= maximum) return { lines: all.map(text => ({ text, tone: 'plain' })), hidden: 0 }
  return {
    lines: all.slice(-maximum).map(text => ({ text, tone: 'plain' })),
    hidden: all.length - maximum,
  }
}

function head(text: string | undefined, maximum: number): { lines: readonly BodyLine[]; hidden: number } {
  const all = linesOf(text)
  if (all.length <= maximum) return { lines: all.map(text => ({ text, tone: 'plain' })), hidden: 0 }
  return {
    lines: all.slice(0, maximum).map(text => ({ text, tone: 'plain' })),
    hidden: all.length - maximum,
  }
}

function diffBody(diffs: readonly ToolFileDiff[], maximum: number, expanded: boolean): EntryBody {
  const lines: BodyLine[] = []
  for (const diff of diffs) {
    if (diffs.length > 1) lines.push({ text: diff.path, tone: 'path' })
    for (const line of linesOf(diff.oldText ?? '')) lines.push({ text: `- ${line}`, tone: 'del' })
    for (const line of linesOf(diff.newText)) lines.push({ text: `+ ${line}`, tone: 'add' })
  }
  const visible = expanded ? lines : lines.slice(0, maximum)
  return {
    lines: visible,
    hiddenLines: Math.max(0, lines.length - visible.length),
  }
}

function resultContentText(view: ToolResultView | ToolCallView | undefined): string | undefined {
  if (view === undefined) return undefined
  if ((view.card === 'generic' || view.card === 'read') && 'content' in view) {
    const content = view.content
    if (content === undefined) return undefined
    const text = content.map(block => block.type === 'text' ? block.text ?? '' : '').join('').trimEnd()
    return text === '' ? undefined : text
  }
  if (view.card === 'terminal') {
    const output = 'output' in view ? view.output : undefined
    return output === undefined || output === '' ? undefined : output
  }
  return undefined
}

function viewTitle(view: ToolResultView | ToolCallView | undefined): string | undefined {
  if (view === undefined) return undefined
  if ('title' in view && typeof view.title === 'string' && view.title !== '') return view.title
  return undefined
}

function pathOf(args: Record<string, unknown> | undefined, view: ToolResultView | ToolCallView | undefined): string | undefined {
  if (view !== undefined && 'path' in view) {
    const path = stringValue(view.path)
    if (path !== undefined) return path
  }
  if (args === undefined) return undefined
  return stringValue(args.path)
    ?? stringValue(args.file_path)
    ?? stringValue(args.filePath)
    ?? stringValue(args.file)
}

function readRange(args: Record<string, unknown> | undefined): string {
  if (args === undefined) return ''
  const offset = numberValue(args.offset)
  const limit = numberValue(args.limit)
  if (offset === undefined && limit === undefined) return ''
  const start = offset === undefined ? 1 : Math.max(1, offset + 1)
  if (limit === undefined) return `:${start}-`
  return `:${start}-${start + Math.max(0, limit) - 1}`
}

function shellCommand(args: Record<string, unknown> | undefined, view: ToolResultView | ToolCallView | undefined, name: string): string {
  const command = stringValue(args?.command) ?? stringValue(args?.text) ?? viewTitle(view)
  if (command !== undefined) return command
  return toolDisplayName(name, view?.displayKey)
}

function statusOf(tool: ToolRow): EntryStatus {
  return tool.status === 'running' ? 'running' : tool.status === 'error' ? 'error' : 'ok'
}

function toneOf(kind: ToolKind): EntryTone {
  switch (kind) {
    case 'shell':
      return 'exec'
    case 'read':
    case 'list':
    case 'search':
      return 'read'
    case 'write':
    case 'edit':
      return 'write'
    case 'webfetch':
    case 'websearch':
      return 'web'
    case 'job':
      return 'task'
    default:
      return 'muted'
  }
}

function pendingOf(kind: ToolKind): string {
  switch (kind) {
    case 'shell':
      return t('tool-pending-running')
    case 'read':
      return t('tool-pending-reading')
    case 'list':
      return t('tool-pending-listing')
    case 'search':
      return t('tool-pending-searching')
    case 'write':
      return t('tool-pending-writing')
    case 'edit':
      return t('tool-pending-editing')
    case 'webfetch':
    case 'websearch':
      return t('tool-pending-fetching')
    case 'job':
      return t('tool-pending-job')
    default:
      return t('tool-pending-running')
  }
}

function durationOf(tool: ToolRow): number | undefined {
  if (tool.status === 'running' || tool.durationMs === undefined || tool.durationMs < 1000) return undefined
  return tool.durationMs
}

function errorBody(tool: ToolRow, expanded: boolean): EntryBody | undefined {
  const lines = linesOf(tool.errorText)
  if (lines.length === 0) return undefined
  const visible = expanded ? lines : lines.slice(0, 1)
  return {
    lines: visible.map(text => ({ text, tone: 'error' })),
    hiddenLines: Math.max(0, lines.length - visible.length),
  }
}

function bashEntry(tool: ToolRow, expanded: boolean): Entry {
  const args = parseArgs(tool.argsFull ?? tool.argsText)
  const view = tool.resultView ?? tool.callView
  const status = statusOf(tool)
  const command = shellCommand(args, view, tool.name)
  const output = resultContentText(view) ?? tool.resultText
  const body = status === 'error'
    ? errorBody(tool, expanded)
    : (() => {
        const preview = tail(output, expanded ? EXPANDED_BODY_LINES : SHELL_BODY_LINES, true)
        if (preview.lines.length === 0) return undefined
        return { lines: preview.lines, hiddenLines: preview.hidden } satisfies EntryBody
      })()
  const exitCode = tool.resultView?.card === 'terminal' ? tool.resultView.exitCode : undefined
  const signal = tool.resultView?.card === 'terminal' ? tool.resultView.signal : undefined
  const metaParts: string[] = []
  if (status === 'ok' && exitCode !== undefined) metaParts.push(`exit ${exitCode}`)
  if (status === 'ok' && signal !== undefined) metaParts.push(`signal ${signal}`)
  const duration = durationOf(tool)
  return {
    tone: 'exec',
    mode: 'block',
    title: `$ ${command}`,
    ...(metaParts.length === 0 ? {} : { meta: metaParts.join(' · ') }),
    ...(duration === undefined ? {} : { durationMs: duration }),
    status,
    pending: pendingOf('shell'),
    ...(status === 'running' ? { elapsedMs: Date.now() - tool.startedAt, startedAt: tool.startedAt } : {}),
    ...(body === undefined ? {} : { body }),
    expandable: body !== undefined || (tool.errorText?.includes('\n') ?? false),
    ...(tool.errorText === undefined ? {} : { error: tool.errorText }),
  }
}

function readEntry(tool: ToolRow, kind: 'read' | 'list' | 'search'): Entry {
  const args = parseArgs(tool.argsFull ?? tool.argsText)
  const view = tool.resultView ?? tool.callView
  const status = statusOf(tool)
  const name = toolDisplayName(tool.name, view?.displayKey)
  let title = viewTitle(view) ?? name
  if (kind === 'read') {
    const path = pathOf(args, view)
    if (path !== undefined) title = `${name} ${path}${readRange(args)}`
  } else if (kind === 'list') {
    const path = pathOf(args, view) ?? stringValue(args?.path)
    title = path === undefined ? name : `${name} ${path}`
  } else {
    const pattern = stringValue(args?.pattern) ?? stringValue(args?.query) ?? stringValue(args?.glob)
    const path = stringValue(args?.path)
    if (pattern !== undefined) title = `${name} "${pattern}"${path === undefined ? '' : ` in ${path}`}`
  }
  const metaParts: string[] = []
  if (kind === 'search' && view?.card === 'search') {
    metaParts.push(`${view.total} ${view.total === 1 ? 'match' : 'matches'}`)
  }
  if (kind === 'list') {
    const content = resultContentText(view)
    const count = content === undefined ? 0 : linesOf(content).length
    if (count > 0) metaParts.push(`${count} ${count === 1 ? 'entry' : 'entries'}`)
  }
  const duration = durationOf(tool)
  return {
    tone: toneOf(kind),
    mode: 'inline',
    title,
    ...(metaParts.length === 0 ? {} : { meta: metaParts.join(' · ') }),
    ...(duration === undefined ? {} : { durationMs: duration }),
    status,
    pending: pendingOf(kind),
    ...(status === 'running' ? { elapsedMs: Date.now() - tool.startedAt, startedAt: tool.startedAt } : {}),
    expandable: tool.errorText?.includes('\n') ?? false,
    ...(tool.errorText === undefined ? {} : { error: tool.errorText }),
  }
}

function writeEntry(tool: ToolRow, expanded: boolean): Entry {
  const args = parseArgs(tool.argsFull ?? tool.argsText)
  const view = tool.resultView ?? tool.callView
  const status = statusOf(tool)
  const path = pathOf(args, view)
  const content = stringValue(args?.content) ?? resultContentText(view)
  const preview = head(content, expanded ? EXPANDED_BODY_LINES : CODE_BODY_LINES)
  const body: EntryBody | undefined = preview.lines.length === 0
    ? undefined
    : { lines: preview.lines, hiddenLines: preview.hidden }
  const duration = durationOf(tool)
  return {
    tone: 'write',
    mode: 'block',
    title: `${toolDisplayName(tool.name, view?.displayKey)}${path === undefined ? '' : ` ${path}`}`,
    ...(duration === undefined ? {} : { durationMs: duration }),
    status,
    pending: pendingOf('write'),
    ...(status === 'running' ? { elapsedMs: Date.now() - tool.startedAt, startedAt: tool.startedAt } : {}),
    ...(body === undefined ? {} : { body }),
    expandable: body !== undefined || (tool.errorText?.includes('\n') ?? false),
    ...(tool.errorText === undefined ? {} : { error: tool.errorText }),
  }
}

function editEntry(tool: ToolRow, expanded: boolean): Entry {
  const args = parseArgs(tool.argsFull ?? tool.argsText)
  const view = tool.resultView ?? tool.callView
  const status = statusOf(tool)
  const path = pathOf(args, view)
  const diffs = view?.card === 'diff' ? view.diffs : []
  const body = diffs.length === 0 ? undefined : diffBody(diffs, expanded ? EXPANDED_BODY_LINES : DIFF_BODY_LINES, expanded)
  const duration = durationOf(tool)
  return {
    tone: 'write',
    mode: 'block',
    title: `${toolDisplayName(tool.name, view?.displayKey)}${path === undefined ? '' : ` ${path}`}`,
    ...(duration === undefined ? {} : { durationMs: duration }),
    status,
    pending: pendingOf('edit'),
    ...(status === 'running' ? { elapsedMs: Date.now() - tool.startedAt, startedAt: tool.startedAt } : {}),
    ...(body === undefined ? {} : { body }),
    expandable: body !== undefined || (tool.errorText?.includes('\n') ?? false),
    ...(tool.errorText === undefined ? {} : { error: tool.errorText }),
  }
}

function genericEntry(tool: ToolRow, expanded: boolean): Entry {
  const args = parseArgs(tool.argsFull ?? tool.argsText)
  const view = tool.resultView ?? tool.callView
  const status = statusOf(tool)
  const name = toolDisplayName(tool.name, view?.displayKey)
  const title = viewTitle(view) ?? name
  const summary = primitiveSummary(args)
  const result = resultContentText(view) ?? tool.resultText
  const bodyLines = linesOf(result)
  const body: EntryBody | undefined = bodyLines.length === 0
    ? undefined
    : {
        lines: (expanded ? bodyLines.slice(0, EXPANDED_BODY_LINES) : bodyLines.slice(0, INLINE_GENERIC_BODY_LINES)).map(text => ({ text, tone: 'plain' })),
        hiddenLines: expanded ? Math.max(0, bodyLines.length - EXPANDED_BODY_LINES) : Math.max(0, bodyLines.length - INLINE_GENERIC_BODY_LINES),
      }
  const duration = durationOf(tool)
  return {
    tone: 'muted',
    mode: 'inline',
    title: summary === undefined ? title : `${title} ${summary}`,
    ...(duration === undefined ? {} : { durationMs: duration }),
    status,
    pending: pendingOf('generic'),
    ...(status === 'running' ? { elapsedMs: Date.now() - tool.startedAt, startedAt: tool.startedAt } : {}),
    ...(body === undefined ? {} : { body }),
    expandable: body !== undefined || (tool.errorText?.includes('\n') ?? false),
    ...(tool.errorText === undefined ? {} : { error: tool.errorText }),
  }
}

/** Build the presentation for one tool call. Pure: no React, no clocks. */
export function toolEntryOf(tool: ToolRow, options: EntryOptions): Entry {
  const kind = toolKindOf(tool.name)
  const expanded = options.expanded
  if (kind === 'shell') return bashEntry(tool, expanded)
  if (kind === 'read' || kind === 'list' || kind === 'search') return readEntry(tool, kind)
  if (kind === 'write') return writeEntry(tool, expanded)
  if (kind === 'edit') return editEntry(tool, expanded)
  if (kind === 'job') {
    const view = tool.resultView ?? tool.callView
    const status = statusOf(tool)
    const duration = durationOf(tool)
    const result = resultContentText(view) ?? tool.resultText
    const bodyLines = linesOf(result)
    const body = bodyLines.length === 0
      ? undefined
      : {
          lines: (expanded ? bodyLines.slice(-EXPANDED_BODY_LINES) : bodyLines.slice(-2)).map(text => ({ text, tone: 'plain' as const })),
          hiddenLines: expanded ? Math.max(0, bodyLines.length - EXPANDED_BODY_LINES) : Math.max(0, bodyLines.length - 2),
        }
    return {
      tone: 'task',
      mode: 'inline',
      title: (() => {
        const name = toolDisplayName(tool.name, view?.displayKey)
        const args = parseArgs(tool.argsFull ?? tool.argsText)
        const id = stringValue(args?.job_id) ?? stringValue(args?.jobId) ?? stringValue(args?.id)
        return id === undefined ? name : `${name} ${id}`
      })(),
      ...(duration === undefined ? {} : { durationMs: duration }),
      status,
      pending: pendingOf('job'),
      ...(status === 'running' ? { elapsedMs: Date.now() - tool.startedAt, startedAt: tool.startedAt } : {}),
      ...(body === undefined ? {} : { body }),
      expandable: body !== undefined || (tool.errorText?.includes('\n') ?? false),
      ...(tool.errorText === undefined ? {} : { error: tool.errorText }),
    }
  }
  return genericEntry(tool, expanded)
}

function subagentStatusLabel(status: SubagentRow['status']): string {
  switch (status) {
    case 'completed':
      return t('subagent-status-completed')
    case 'failed':
      return t('subagent-status-failed')
    case 'cancelled':
      return t('subagent-status-cancelled')
    case 'unknown':
      return t('subagent-status-unknown')
    default:
      return t('subagent-status-running')
  }
}

/** Subagent row as a single activity line (running output preview optional). */
export function subagentEntryOf(subagent: SubagentRow): Entry {
  const elapsed = subagent.completedAt !== undefined
    ? Math.max(0, subagent.completedAt - subagent.startedAt)
    : Math.max(0, Date.now() - subagent.startedAt)
  const tokens = subagent.tokens?.total ?? ((subagent.tokens?.input ?? 0) + (subagent.tokens?.output ?? 0))
  const metaParts = [
    subagent.model ?? subagent.provider,
    subagent.effort,
    tokens > 0 ? `${tokens} tok` : undefined,
    `${subagent.toolCalls.length} tools`,
    subagentStatusLabel(subagent.status),
  ].filter((part): part is string => part !== undefined && part !== '')
  const output = subagent.outputLines.slice(-2).map(text => ({ text, tone: 'dim' as const }))
  return {
    tone: 'task',
    mode: 'inline',
    title: `${t('subagent-card-prefix')}${subagent.description}`,
    meta: metaParts.join(' · '),
    ...(subagent.status === 'running' || subagent.status === 'starting' ? {} : { durationMs: subagent.durationMs ?? elapsed }),
    status: subagent.status === 'completed' ? 'ok' : subagent.status === 'failed' || subagent.status === 'cancelled' ? 'error' : 'running',
    pending: t('tool-pending-subagent'),
    elapsedMs: elapsed,
    startedAt: subagent.startedAt,
    ...(output.length === 0 ? {} : { body: { lines: output, hiddenLines: 0 } }),
    expandable: subagent.outputLines.length > 0 || (subagent.error?.includes('\n') ?? false),
    ...(subagent.error === undefined ? {} : { error: subagent.error }),
  }
}
