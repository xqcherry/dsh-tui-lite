import type { Theme } from './theme.js'

const TOOL_NAME_MUTATE = new Set(['edit', 'write', 'multiedit', 'notebookedit'])
const TOOL_NAME_EXEC = new Set(['bash', 'bashpersistent', 'sh', 'shell', 'terminal'])
export function toolNameColor(raw: string, category?: 'mutate' | 'exec' | 'other'): keyof Theme {
  // A backend-declared colour family wins over the id heuristics below.
  if (category === 'mutate') return 'toolNameMutate'
  if (category === 'exec') return 'toolNameExec'
  if (category === 'other') return 'accent'
  const n = raw.toLowerCase()
  if (TOOL_NAME_MUTATE.has(n)) return 'toolNameMutate'
  if (TOOL_NAME_EXEC.has(n)) return 'toolNameExec'
  return 'accent'
}
