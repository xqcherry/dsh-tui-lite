/**
 * Data-directory paths for the dsh-tui profile. All preferences and history
 * live under `~/.dsh-tui`.
 *
 * The compiled copy (lib/types/utils/paths.js) is also imported by the bin
 * launcher, mirroring the shellQuote precedent.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The user's home directory. `os.homedir()` first; the USERPROFILE/HOME
 * spellings are the last-resort fallback for stripped-down environments.
 * @returns Absolute home path.
 */
export function homeDir(): string {
  return homedir() || process.env.USERPROFILE || process.env.HOME || ''
}

/** Display-only home abbreviation; unrelated paths and remote URIs stay intact. */
export function abbreviateHomePath(path: string, home = homeDir()): string {
  if (!home) return path
  const separator = home.includes('\\') ? '\\' : '/'
  const prefix = home.endsWith(separator) ? home : home + separator
  if (path === home || path === prefix) return '~'
  if (!path.startsWith(prefix)) return path
  return `~/${path.slice(prefix.length).split(separator).join('/')}`
}

/** Data directory all preferences/history live in (`~/.dsh-tui`). */
export const DATA_DIR = join(homeDir(), '.dsh-tui')
