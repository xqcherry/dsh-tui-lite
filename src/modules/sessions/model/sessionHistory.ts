/**
 * Client resume marker and recent-session metadata. Session records remain
 * owned by dsh persistence; this file stores only IDs and last-used times.
 * Startup reads the marker for a bare `--resume`, `-c` or `--continue`.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from '../../../shared/platform/paths.js'

const DIR = DATA_DIR
const RESUME_FILE = join(DIR, 'resume.txt')
const LAST_USED_FILE = join(DIR, 'last-used.json')
let lastUsedStamp: string | undefined
let lastUsedCache: Readonly<Record<string, number>> | undefined

function lastUsedFileStamp(): string | undefined {
  try {
    const stats = statSync(LAST_USED_FILE)
    return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`
  } catch {
    return undefined
  }
}
/**
 * The agent view's OWN ledger: session-id → epoch-ms of the moments this TUI
 * dispatched, backgrounded, or attached to a session FROM the agent view.
 * Unlike last-used.json (every /resume touch), this is the "background
 * session" record used by the session overview — ordinary history never lands
 * here, so the view lists only sessions it actually manages.
 */
const AGENT_VIEW_SESSIONS_FILE = join(DIR, 'agent-view-sessions.json')

function ensureDir(): void {
  mkdirSync(DIR, { recursive: true })
}

/**
 * Store the session to resume and report the launcher invocation.
 * @param sessionId - Session id for `dsl --resume` on the next launch.
 */
export function writeResumeTarget(sessionId: string): void {
  ensureDir()
  writeFileSync(RESUME_FILE, sessionId)
}

/** Forget the resume marker (`/new` starts a fresh conversation). */
export function clearResumeTarget(): void {
  try {
    writeFileSync(RESUME_FILE, '')
  } catch {
    // Best effort — the marker is a launcher nicety.
  }
}

/**
 * The session id requested by `dsl --resume`, if any.
 * @returns The stored session id, or undefined when none is set.
 */
export function readResumeTarget(): string | undefined {
  try {
    const value = readFileSync(RESUME_FILE, 'utf8').trim()
    return value || undefined
  } catch {
    return undefined
  }
}

/** Read a session selector from app args; `--` starts literal prompt text. */
export function resumeTargetFromArgv(
  argv: readonly string[],
  /** A bare selector uses the marker unless the caller supplies a fallback. */
  readFallback: () => string | undefined = readResumeTarget,
): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') break
    if (isResumeFlag(a)) {
      let sessionId = ''
      if (a.startsWith('--resume=')) {
        sessionId = a.slice('--resume='.length).trim()
      } else if (resumeTakesNextArg(argv, i)) {
        sessionId = argv[++i].trim()
      }
      if (!sessionId) sessionId = readFallback() ?? ''
      if (sessionId) return sessionId
    }
  }
  return undefined
}

/** A resume flag of the app argv grammar shared by the two functions here. */
function isResumeFlag(arg: string): boolean {
  return arg === '--resume' || arg === '-c' || arg === '--continue' || arg.startsWith('--resume=')
}

/** `--resume <id>`: the bare flag consumes the next argument unless it is an option. */
function resumeTakesNextArg(argv: readonly string[], index: number): boolean {
  const next = argv[index + 1]
  return argv[index] === '--resume' && next !== undefined && !next.startsWith('-')
}

/**
 * Session-id → last-used epoch ms map for MRU ordering.
 * @returns The parsed map; best effort, an unreadable file yields {}.
 */
export function readLastUsed(): Readonly<Record<string, number>> {
  const stamp = lastUsedFileStamp()
  if (lastUsedCache !== undefined && lastUsedStamp === stamp) return lastUsedCache
  try {
    const parsed = JSON.parse(readFileSync(LAST_USED_FILE, 'utf8')) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      lastUsedCache = {}
      lastUsedStamp = stamp
      return lastUsedCache
    }
    const record = parsed as Record<string, unknown>
    const result: Record<string, number> = {}
    for (const [id, value] of Object.entries(record)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        result[id] = value
      }
    }
    lastUsedCache = result
    lastUsedStamp = stamp
    return result
  } catch {
    lastUsedCache = {}
    lastUsedStamp = stamp
    return lastUsedCache
  }
}

/**
 * Record that a session was just used (resumed or written to) so `/resume`
 * can sort most-recently-used first. Best effort — never throws.
 * @param sessionId - Session id to touch.
 */
export function touchSession(sessionId: string): void {
  try {
    ensureDir()
    const lastUsed = { ...readLastUsed(), [sessionId]: Date.now() }
    writeFileSync(LAST_USED_FILE, JSON.stringify(lastUsed))
    lastUsedCache = lastUsed
    lastUsedStamp = lastUsedFileStamp()
  } catch {
    // Best effort — MRU ordering is a nicety.
  }
}

/**
 * Drop a session's last-used entry (`/resume` picker delete) so the MRU map
 * never accumulates ids whose logs are gone. Best effort — never throws.
 * @param sessionId - Session id to forget.
 */
export function forgetSession(sessionId: string): void {
  try {
    const lastUsed: Record<string, number> = { ...readLastUsed() }
    if (!(sessionId in lastUsed)) return
    delete lastUsed[sessionId]
    ensureDir()
    writeFileSync(LAST_USED_FILE, JSON.stringify(lastUsed))
    lastUsedCache = lastUsed
    lastUsedStamp = lastUsedFileStamp()
  } catch {
    // Best effort — a stale entry only skews sort order.
  }
}

/**
 * The agent-view ledger (see {@link AGENT_VIEW_SESSIONS_FILE}): session-id →
 * epoch-ms. Best effort — an unreadable file yields {}.
 * @returns The parsed map.
 */
export function readAgentViewSessions(): Readonly<Record<string, number>> {
  try {
    const parsed = JSON.parse(readFileSync(AGENT_VIEW_SESSIONS_FILE, 'utf8')) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const record = parsed as Record<string, unknown>
    const result: Record<string, number> = {}
    for (const [id, value] of Object.entries(record)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        result[id] = value
      }
    }
    return result
  } catch {
    return {}
  }
}

/**
 * Record a session as agent-view-managed (dispatched, backgrounded, or
 * attached from the view). Best effort — never throws.
 * @param sessionId - Session id to record.
 */
export function touchAgentViewSession(sessionId: string): void {
  try {
    ensureDir()
    const sessions = { ...readAgentViewSessions(), [sessionId]: Date.now() }
    writeFileSync(AGENT_VIEW_SESSIONS_FILE, JSON.stringify(sessions))
  } catch {
    // Best effort — the ledger is a display filter, not state.
  }
}

/**
 * Drop a session from the agent-view ledger (its log was deleted). Best
 * effort — never throws.
 * @param sessionId - Session id to forget.
 */
export function forgetAgentViewSession(sessionId: string): void {
  try {
    const sessions: Record<string, number> = { ...readAgentViewSessions() }
    if (!(sessionId in sessions)) return
    delete sessions[sessionId]
    ensureDir()
    writeFileSync(AGENT_VIEW_SESSIONS_FILE, JSON.stringify(sessions))
  } catch {
    // Best effort — a stale entry only lists one extra stopped row.
  }
}
