import { t, tOr, type I18nKey } from '../i18n.js'

/** Tool display names localize through the `tool-name-*` family. Unmapped
 *  ids (plugins, new upstream tools) fall back to the id with its first
 *  letter uppercased: that is a name, not copy — there is nothing to
 *  translate. */
const TOOL_NAME_KEYS: Record<string, I18nKey> = {
  bash: 'tool-name-bash',
  powershell: 'tool-name-powershell',
  read: 'tool-name-read',
  read_file: 'tool-name-read_file',
  list_dir: 'tool-name-list_dir',
  glob: 'tool-name-glob',
  grep: 'tool-name-grep',
  write: 'tool-name-write',
  write_file: 'tool-name-write_file',
  edit: 'tool-name-edit',
  todo_write: 'tool-name-todo_write',
  subagent: 'tool-name-subagent',
  web_search: 'tool-name-web_search',
  web_fetch: 'tool-name-web_fetch',
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
