/**
 * Persisted default session accent color (`~/.dsh-tui/session-color.json`).
 *
 * `/color` writes the current session's durable `session/color` event AND the
 * choice here, so a NEW session starts on the last color instead of the theme
 * default. A resumed session still prefers its own event; the file is only
 * the fallback for sessions that never recorded one. Best effort: a missing,
 * corrupt, or unknown color falls back to the theme default.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from '../../../shared/platform/paths.js'
import { isValidSessionColor } from '../../../shared/session-colors.js'

const PREFS_DIR = DATA_DIR
const PREFS_FILE = 'session-color.json'

/**
 * The persisted default color name, or undefined when unset or invalid.
 * @param dir - Prefs directory (injectable for tests).
 * @returns A known session color name, if one is persisted.
 */
export function readSessionColorPref(dir: string = PREFS_DIR): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, PREFS_FILE), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const color = (parsed as Record<string, unknown>).color
    return typeof color === 'string' && isValidSessionColor(color) ? color : undefined
  } catch {
    return undefined
  }
}

/**
 * Persist the default color for new sessions (best effort). An empty string
 * clears it, restoring the theme default.
 * @param color - A known session color name, or '' to clear.
 * @param dir - Prefs directory (injectable for tests).
 * @returns True when the file was written, false for an unknown color or a
 *   write failure.
 */
export function writeSessionColorPref(color: string, dir: string = PREFS_DIR): boolean {
  if (color !== '' && !isValidSessionColor(color)) return false
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, PREFS_FILE), JSON.stringify({ color }, null, 2))
    return true
  } catch {
    return false
  }
}
