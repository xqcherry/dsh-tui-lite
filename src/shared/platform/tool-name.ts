import { t, tOr, type I18nKey } from '../i18n.js'

/** Tool display names localize through the `tool-name-*` family. Unmapped
 *  ids (plugins, new upstream tools) fall back to the id with its first
 *  letter uppercased: that is a name, not copy — there is nothing to
 *  translate. */
const TOOL_NAME_KEYS: Record<string, I18nKey> = {
  bash: 'tool-name-bash',
  powershell: 'tool-name-powershell',
  read: 'tool-name-read',
  glob: 'tool-name-glob',
  grep: 'tool-name-grep',
  write: 'tool-name-write',
  edit: 'tool-name-edit',
  todo_write: 'tool-name-todo_write',
  subagent: 'tool-name-subagent',
  web_search: 'tool-name-web_search',
  job_output: 'tool-name-job_output',
  job_list: 'tool-name-job_list',
  job_kill: 'tool-name-job_kill',
}

export function toolDisplayName(name: string, displayKey?: string): string {
  // A backend that names its tools its own way (Claude `Read`, `Bash`)
  // supplies the key with the card view; the raw name is the fallback.
  if (displayKey !== undefined) return tOr(displayKey, name)
  const key = TOOL_NAME_KEYS[name.toLowerCase()]
  if (key !== undefined) return t(key)
  if (name.length === 0) return name
  return name[0]!.toUpperCase() + name.slice(1)
}

/** Shell and background-job control calls share the compact transcript
 *  treatment: their settled cards collapse to the header, and consecutive
 *  calls of the same tool fold into one summary line. */
export const QUIET_TOOL_NAMES: ReadonlySet<string> = new Set([
  'bash',
  'bashpersistent',
  'sh',
  'shell',
  'terminal',
  'powershell',
  'pwsh',
  'job_output',
  'job_list',
  'job_kill',
])

export function isQuietTool(
  tool: { readonly name: string },
  view?: { readonly category?: 'mutate' | 'exec' | 'other' },
): boolean {
  return view?.category === 'exec' || QUIET_TOOL_NAMES.has(tool.name.toLowerCase())
}
