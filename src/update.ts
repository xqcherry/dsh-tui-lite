import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gte, gt, lt, valid } from 'semver'
import { shellQuote } from './utils/shellQuote.js'
import { DATA_DIR } from './utils/paths.js'
import { stripResumeArgs } from './sessionHistory.js'
import { KERNEL_SWITCH_HANDOFF_ENV, isKernelId, kernelDisplayName, type KernelBackendId } from './kernelPrefs.js'
import { classifyReplacementOutcome, formatHandoffNotice, handoffEventTag, writeHandoffStage } from './handoffEvents.js'
import { HANDOFF_ACK_FD_ENV, HANDOFF_ATTEMPT_ENV, HANDOFF_SCREEN_ENV, parseHandoffAckLine } from './handoffAck.js'
import { DISABLE_KITTY_KEYBOARD, DISABLE_MODIFY_OTHER_KEYS, DISABLE_WIN32_INPUT_MODE } from './ink/termio/csi.js'
import { DBP, DFE, DISABLE_MOUSE_TRACKING, EXIT_ALT_SCREEN, SHOW_CURSOR } from './ink/termio/dec.js'

// Re-exported for scripts/verify-update.mjs and the bin launcher, which reads
// the compiled copy at lib/types/utils/shellQuote.js.
export { shellQuote }

const PACKAGE_NAME = '@deepseek-harness-tui/dsh-tui'
const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
const UPDATE_CHECK_TIMEOUT_MS = 4000
/** env marker set on the /update restart; the new process verifies it at boot. */
const UPDATED_FROM_ENV = 'DSH_TUI_UPDATED_FROM'
/**
 * env marker set on the /restart replacement: its boot logs to restart.log
 * (ordinary launches stay silent, so the file is restart-only evidence).
 */
const RESTART_CHILD_ENV = 'DSH_TUI_RESTART_CHILD'

/**
 * Field-diagnosis log for the /restart terminal handoff, appended by BOTH
 * processes: the exiting TUI logs the funnel path, the spawned replacement
 * logs its boot progress, and every line carries pid + timestamp — so a
 * handoff that dies at any stage (loader entry, TTY gate, session resume,
 * even after the parent's survival window) leaves breadcrumbs on disk even
 * when nothing reaches the already-confused terminal. Diagnosis only: every
 * write is best effort and must never break the handoff itself.
 */
const RESTART_LOG = join(DATA_DIR, 'restart.log')
/** Cap so a long debugging streak cannot grow the log unbounded. */
const RESTART_LOG_MAX_BYTES = 256 * 1024

function writeRestartLine(line: string): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    appendFileSync(RESTART_LOG, `${new Date().toISOString()} pid=${process.pid} ${line}\n`)
  } catch {
    // Diagnosis only.
  }
}

/**
 * Append a /restart handoff event to ~/.dsh-tui/restart.log.
 * @param event - Short stable event name.
 * @param data - Small JSON-safe detail (never credentials or session text).
 */
export function logRestartEvent(event: string, data?: Record<string, unknown>): void {
  writeRestartLine(`${event}${data === undefined ? '' : ` ${JSON.stringify(data)}`}`)
}

/**
 * `~/.dsh-tui/last-run.json`: which kernel and session the most recent TUI
 * instance ran, written at boot (plugin.ts) and refreshed by the exit funnel.
 * The launcher's safe-mode retry reads it. After a kernel switch the
 * launcher's own env still names the original backend, so retrying from that
 * env would reopen the old kernel, or hand a DSH session id to a Claude boot.
 * kernel.json has the backend but not the session or when it was written.
 */
export interface LastRunRecord {
  /** The kernel THIS instance ran on (Config domain: KernelBackendId). */
  readonly backendId: KernelBackendId
  /** The resumable session id on that backend; '' = nothing resumable (the
   *  retry cold-starts the backend instead of resuming across domains). */
  readonly sessionId: string
  /** The session's working directory (diagnostics; the retry keeps the
   *  launch cwd, it does not chdir from this field). */
  readonly cwd: string
  /** Which boot wrote this record (pid+clock id; diagnostics and
   *  generation comparisons). */
  readonly attemptId: string
  /** epoch-ms stamp (added by writeLastRunRecord): the launcher compares it
   *  against its own start to tell this-chain records from a previous
   *  launch's leftovers. */
  readonly updatedAt: number
  /** Writer pid (diagnostics). */
  readonly pid?: number
}

const LAST_RUN_FILE = join(DATA_DIR, 'last-run.json')

/** Windows rename retry cell (kernelPrefs writeKernelPrefs precedent). */
const lastRunWaitCell = new Int32Array(new SharedArrayBuffer(4))

/**
 * Stamp the last-run record atomically (tmp + rename, so the launcher's read
 * never sees half a file). Best effort, never throws: a failed stamp only
 * degrades the launcher's retry to its legacy sniffing path.
 * @param record - Identity without updatedAt (stamped here, one clock).
 * @param file - Path override (verify scripts point at a temp dir).
 */
export function writeLastRunRecord(
  record: Omit<LastRunRecord, 'updatedAt'>,
  file: string = LAST_RUN_FILE,
): void {
  const temporary = join(dirname(file), `.last-run.${process.pid}.${Date.now()}.tmp`)
  try {
    mkdirSync(dirname(file), { recursive: true })
    const updatedAt = Date.now()
    writeFileSync(temporary, `${JSON.stringify({ ...record, updatedAt }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(temporary, file)
        return
      } catch (error) {
        const code = typeof error === 'object' && error !== null ? String((error as NodeJS.ErrnoException).code) : ''
        if (process.platform !== 'win32' || attempt >= 7 || (code !== 'EPERM' && code !== 'EBUSY')) throw error
        Atomics.wait(lastRunWaitCell, 0, 0, 2 ** attempt)
      }
    }
  } catch (error) {
    try {
      rmSync(temporary, { force: true })
    } catch {
      // The previous record stays; no safe remedy.
    }
    writeRestartLine(`last-run record write failed (${error instanceof Error ? error.message : String(error)})`)
  }
}

/**
 * Read the last-run record; unreadable/invalid/missing yields undefined (the
 * caller falls back to its legacy behavior). Never throws.
 * @param file - Path override (verify scripts point at a temp dir).
 */
export function readLastRunRecord(file: string = LAST_RUN_FILE): LastRunRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    if (!isKernelId(record.backendId)) return undefined
    if (typeof record.sessionId !== 'string' || typeof record.cwd !== 'string' || typeof record.attemptId !== 'string') return undefined
    if (typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)) return undefined
    return {
      backendId: record.backendId,
      sessionId: record.sessionId,
      cwd: record.cwd,
      attemptId: record.attemptId,
      updatedAt: record.updatedAt,
      ...(typeof record.pid === 'number' ? { pid: record.pid } : {}),
    }
  } catch {
    return undefined
  }
}

/** Start a fresh, clearly delimited /restart attempt block in the log. */
export function beginRestartAttempt(sessionId: string): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    let size = 0
    try {
      size = statSync(RESTART_LOG).size
    } catch {
      size = 0
    }
    if (size > RESTART_LOG_MAX_BYTES) writeFileSync(RESTART_LOG, '')
  } catch {
    // Diagnosis only.
  }
  writeRestartLine(`--- /restart attempt session=${sessionId} ---`)
}

/**
 * Write a handoff notice to stderr synchronously: process.exit() right after
 * an async stream write skips the flush, and a vanished diagnosis is
 * indistinguishable from a silent failure.
 */
export function writeHandoffNotice(text: string): void {
  try {
    writeFileSync(2, text)
  } catch {
    process.stderr.write(text)
  }
}

/**
 * Hand the terminal back after a kernel-switch replacement that cannot clean
 * up after itself: one that died before its first frame (this process still
 * holds the alternate screen) or one killed by a signal. Besides leaving the
 * alternate screen it turns off the input modes the replacement may already
 * have enabled; each reset is harmless if the mode was never on. Written
 * synchronously to fd 1 so the failure notice that follows lands on the main
 * screen.
 */
export function restoreHandoffScreen(): void {
  const reset = DISABLE_MOUSE_TRACKING + DISABLE_MODIFY_OTHER_KEYS + DISABLE_KITTY_KEYBOARD
    + DISABLE_WIN32_INPUT_MODE + DFE + DBP + SHOW_CURSOR + EXIT_ALT_SCREEN + '\r\n'
  try {
    writeFileSync(1, reset)
  } catch {
    try {
      process.stdout.write(reset)
    } catch {
      // Even a dead stdout must not block the exit path.
    }
  }
}

export interface TuiUpdateInfo {
  current: string
  latest: string
}

/** What a fresh registry lookup says about this install. */
export type TuiUpdateTarget =
  | { kind: 'update'; current: string; latest: string; authoritative?: string }
  | { kind: 'latest'; current: string }
  | { kind: 'unknown' }

export interface TuiUpdateResult {
  /** Exit code of the `dsh plugin update` run (0 = the package was updated). */
  updateCode: number
  /**
   * Exit code of the restarted TUI process. Equals `updateCode` when the
   * failure happened before a restart was attempted.
   */
  restartCode: number
}

/** Read the version from either the compiled package or the source checkout. */
export function installedTuiVersion(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const relativePath of ['../../package.json', '../package.json']) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(here, relativePath), 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const packageJson = parsed as Record<string, unknown>
        const version = packageJson.version
        if (packageJson.name === PACKAGE_NAME && typeof version === 'string' && valid(version) !== null) {
          return version
        }
      }
    } catch {
      // Try the source-layout fallback after the compiled-layout path.
    }
  }
  return undefined
}

/**
 * The profile this TUI was booted with (`dsh --profile <name>`), read from
 * the launcher argv the process inherited. dsh sets no profile env var, and
 * its launcher parses its own flags first, so the first `--profile` token in
 * argv is the launcher's. Undefined for non-profile launches (source
 * checkouts, `--config` overlays) — there is no profile installation for
 * `/update` to act on, so the command must stay disabled there.
 */
export function resolveDshProfileName(argv: readonly string[] = process.argv): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--profile') {
      const value = argv[i + 1]
      return value !== undefined && value !== '' && !value.startsWith('-') ? value : undefined
    }
    if (arg.startsWith('--profile=')) {
      const value = arg.slice('--profile='.length)
      return value !== '' ? value : undefined
    }
  }
  return undefined
}

/**
 * Resolve the registry base URL the way npm/pnpm would: `NPM_CONFIG_REGISTRY`
 * (both spellings) over the `registry=` line in ~/.npmrc over npmjs.org, so
 * mirror users see the same `latest` their package manager would install.
 */
export function resolveRegistryBase(): string {
  const fromEnv = process.env.NPM_CONFIG_REGISTRY ?? process.env.npm_config_registry
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv.replace(/\/+$/, '')
  try {
    const npmrc = readFileSync(join(homedir(), '.npmrc'), 'utf8')
    const match = /^\s*registry\s*=\s*(\S+)\s*$/m.exec(npmrc)
    if (match !== null) return match[1].replace(/\/+$/, '')
  } catch {
    // No readable user .npmrc — the default registry applies.
  }
  return DEFAULT_REGISTRY
}

/** True when `current` is a strictly newer valid version than `previous`. */
export function isVersionNewer(current: string, previous: string): boolean {
  const a = valid(current)
  const b = valid(previous)
  return a !== null && b !== null && gt(a, b)
}

/**
 * Versions whose compiled plugin hard-injects `tuiWorkspaces`
 * ('0.7.0'–'0.7.1'; removed in 0.7.2). Installing one while the globally
 * installed launcher copy predates the `dsh-tui-workspaces` patch row
 * deadlocks boot forever at "pending (waiting for service: tuiWorkspaces)"
 * (issues #183/#307) — and /update reaching such a target is exactly how
 * stale-mirror installs stranded users. /update must refuse them.
 * @param version - the candidate install target.
 * @returns true for the known boot-deadlock version range.
 */
export function isBootDeadlockTarget(version: string): boolean {
  const v = valid(version)
  return v !== null && gte(v, '0.7.0') && lt(v, '0.7.2')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Fetch `latest` from a registry; undefined on any failure. */
async function fetchLatestVersion(registryBase: string): Promise<string | undefined> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS)
  try {
    const response = await fetch(`${registryBase}/${PACKAGE_NAME}/latest`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return undefined
    const payload: unknown = await response.json()
    const latest = isRecord(payload) && typeof payload.version === 'string'
      ? valid(payload.version)
      : null
    return latest ?? undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Classify this install against a fresh registry lookup: an update is
 * available, the install is already latest, or the answer is unknown
 * (offline / registry error / unreadable own version).
 *
 * The configured registry decides the install target (pnpm must be able to
 * fetch it), but when that registry is a mirror it can lag behind npmjs —
 * issue #307's users were pinned onto stale versions this way. A
 * best-effort npmjs.org check runs in parallel and surfaces as
 * `authoritative` when it knows a strictly newer release, so callers can
 * say "installing X now, official latest is Y" instead of silently
 * upgrading to yesterday's version.
 */
export async function resolveTuiUpdateTarget(): Promise<TuiUpdateTarget> {
  const current = installedTuiVersion()
  const currentVersion = current === undefined ? null : valid(current)
  if (currentVersion === null) return { kind: 'unknown' }

  const registryBase = resolveRegistryBase()
  const [latest, official] = await Promise.all([
    fetchLatestVersion(registryBase),
    registryBase === DEFAULT_REGISTRY ? undefined : fetchLatestVersion(DEFAULT_REGISTRY),
  ])
  if (latest === undefined) return { kind: 'unknown' }
  if (!gt(latest, currentVersion)) return { kind: 'latest', current: currentVersion }
  const authoritative = official !== undefined && gt(official, latest) ? official : undefined
  return { kind: 'update', current: currentVersion, latest, ...(authoritative === undefined ? {} : { authoritative }) }
}

/**
 * Check npm for a newer published TUI version. Network and registry errors
 * are intentionally treated as "no result" so an offline launch never delays
 * or blocks the interactive TUI.
 */
export async function checkForTuiUpdate(): Promise<TuiUpdateInfo | undefined> {
  const target = await resolveTuiUpdateTarget()
  return target.kind === 'update'
    ? {
        current: target.current,
        latest: target.latest,
      }
    : undefined
}

interface ProcessOptions {  env?: NodeJS.ProcessEnv
  /** Needed only for .cmd launchers on Windows (they cannot spawn directly). */
  shell?: boolean
  /**
   * Receives each stderr chunk while output still flows to the terminal, so
   * the caller can classify failures (issue #225's transient-race retry).
   */
  onStderr?: (chunk: string) => void
}

/**
 * Run a child process with its output attached to the user's terminal. The
 * shell is opt-in per call: `dsh.cmd` needs it, but the node restart must
 * never go through cmd.exe — the standard install path
 * `C:\Program Files\nodejs\node.exe` splits on the space and the replacement
 * process never starts, leaving an updated package and a dead TUI.
 */
function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessOptions = {},
): Promise<number> {
  return new Promise(resolve => {
    let settled = false
    const useShell = options.shell === true && process.platform === 'win32'
    // DEP0190 (issue #148): Node ≥22 warns on `shell: true` with a non-empty
    // args array even when every arg is escaped — the check is syntactic.
    // Fold the shell-quoted args into the command string instead (an empty
    // args array does not trigger the warning); future Node majors may turn
    // the deprecation into a hard error.
    const [runCommand, runArgs]: [string, readonly string[]] = useShell
      ? [`${command} ${shellQuote(args).join(' ')}`, []]
      : [command, args]
    const child = spawn(runCommand, runArgs as string[], {
      env: options.env,
      stdio: options.onStderr === undefined ? 'inherit' : ['inherit', 'inherit', 'pipe'],
      shell: useShell,
    })
    if (options.onStderr !== undefined && child.stderr !== null) {
      const onStderr = options.onStderr
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        process.stderr.write(text)
        onStderr(text)
      })
    }
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      resolve(code)
    }
    child.once('error', error => {
      process.stderr.write(`dsh-tui: failed to run ${command}: ${error.message}\n`)
      finish(127)
    })
    child.once('close', code => finish(code ?? 1))
  })
}

/** Build the profile-manager command, preferring a preflight-pinned version. */
export function tuiUpdatePluginArgs(profile: string, targetVersion?: string): string[] {
  return targetVersion === undefined
    ? ['plugin', '--profile', profile, 'update', '--latest', PACKAGE_NAME]
    : ['plugin', '--profile', profile, 'update', `${PACKAGE_NAME}@${targetVersion}`]
}

/**
 * Postinstall-only transitive dependencies of the dsh profile chain
 * (dsh-llm-pi-ai → @earendil-works/pi-ai → @google/genai + protobufjs, plus the
 * esbuild/koffi peers of that chain): pnpm ≥11 refuses to run their build
 * scripts unless the workspace allowlists them, and a profile that never
 * opted in fails the WHOLE install with ERR_PNPM_IGNORED_BUILDS. None of
 * these scripts is needed at runtime (the repo root allowBuilds them all to
 * `false`), so the update flow pre-seeds the profile's pnpm-workspace.yaml
 * with explicit `false` entries — an explicit decision pnpm honors silently.
 */
const PROFILE_ALLOW_BUILDS: Readonly<Record<string, false>> = {
  '@google/genai': false,
  esbuild: false,
  koffi: false,
  protobufjs: false,
}

/** The profile's pnpm-workspace.yaml (`$DSH_HOME ?? ~/.dsh` layout). */
export function profileWorkspaceYamlPath(profile: string): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'profiles', profile, 'pnpm-workspace.yaml')
}

/** What ensureProfileAllowBuilds did to the profile workspace file. */
export interface AllowBuildsOutcome {
  /** Keys already present before this run (left untouched). */
  existing: string[]
  /** Keys this run appended. */
  added: string[]
}

/** YAML key spelling for an allowBuilds entry (scoped names need quotes). */
function allowBuildsKeyLine(key: string): string {
  const needsQuotes = key.includes('@') || key.includes('/')
  return `  ${needsQuotes ? `'${key}'` : key}: false`
}

/**
 * Make sure the profile's pnpm-workspace.yaml carries explicit `false`
 * allowBuilds entries for the dsh-tui chain's postinstall-only deps, so a
 * pnpm ≥11 update is not killed by ERR_PNPM_IGNORED_BUILDS. Best effort and
 * idempotent: existing entries are never overwritten (an explicit user
 * decision wins), a missing `allowBuilds:` block is appended, and a missing
 * file is created. Returns undefined when the profile directory is absent or
 * the file could not be updated — the caller still runs pnpm, whose own
 * ERR_PNPM_IGNORED_BUILDS diagnostic stays the visible fallback.
 */
export function ensureProfileAllowBuilds(profile: string): AllowBuildsOutcome | undefined {
  const yamlPath = profileWorkspaceYamlPath(profile)
  try {
    if (!existsSafe(dirname(yamlPath))) return undefined
    let text = ''
    try {
      text = readFileSync(yamlPath, 'utf8')
    } catch {
      // Missing file — start from an empty document; writeFileSync creates it.
    }
    const lines = text.split(/\r?\n/u)
    let blockStart = -1
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (line !== '' && line === line.trimStart() && /^allowBuilds:/u.test(line)) {
        blockStart = i
        break
      }
    }
    const present = new Set<string>()
    if (blockStart !== -1) {
      for (let i = blockStart + 1; i < lines.length; i += 1) {
        const line = lines[i]
        if (line === '' || line === line.trimStart()) break // dedent = block ends
        const keyMatch = /^\s+('?)(.+?)\1:\s/u.exec(line)
        if (keyMatch !== null) present.add(keyMatch[2])
      }
    }
    const added = Object.keys(PROFILE_ALLOW_BUILDS).filter(key => !present.has(key))
    if (added.length === 0) return { existing: [...present], added }
    const insert = added.map(allowBuildsKeyLine)
    if (blockStart !== -1) {
      // Append after the block's last existing entry (before the next
      // top-level key), so existing entries keep their position.
      let blockEnd = blockStart + 1
      for (let i = blockStart + 1; i < lines.length; i += 1) {
        const line = lines[i]
        if (line === '' || line === line.trimStart()) break
        blockEnd = i + 1
      }
      lines.splice(blockEnd, 0, ...insert)
    } else {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
      lines.push('allowBuilds:', ...insert)
    }
    writeFileSync(yamlPath, `${lines.join('\n')}\n`)
    return { existing: [...present], added }
  } catch {
    return undefined
  }
}

/** What ensureProfileReleaseAgeExclude did to the profile workspace file. */
export interface ReleaseAgeExcludeOutcome {
  /** Final exclude entries after the run (ours plus preserved foreign ones). */
  entries: string[]
  /** True when the file was written (entry added or stale entry replaced). */
  changed: boolean
}

/**
 * pnpm ≥11 delays installs of packages published within `minimumReleaseAge`
 * (24h by default) — on release day that gate refuses the very version
 * `/update` is installing (ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION), which
 * reads to the user as a broken update until the window passes. Pre-seed the
 * profile's pnpm-workspace.yaml with release-age exclusions scoped to this
 * package at the exact versions pnpm verifies before it can swap the package:
 * the target version itself, plus `alsoExempt` — the pre-update `updatedFrom`,
 * read from the running package's own manifest (normally the version the
 * profile lockfile pins). Two releases inside the 24h window leave the OLD
 * lockfile entry inside it too, and pnpm fails the whole policy check on that
 * entry before replacing the package (issue #1205), so exempting only the
 * target is not enough. Same best-effort,
 * idempotent pattern as {@link ensureProfileAllowBuilds}: entries for this
 * package track exactly the versions the current update needs (older own
 * entries are dropped instead of accumulating), foreign entries are
 * preserved, a missing `minimumReleaseAgeExclude` block is appended, a
 * missing file is created, and an absent profile directory resolves to
 * undefined — the caller still runs pnpm, whose own diagnostic stays the
 * visible fallback. Own entries are re-rendered target-first on every
 * rewrite: pnpm 11.7.x honours only the FIRST entry per package (later
 * entries for the same package are ignored against the real registry), and
 * 11.21.x applies every entry in any order, so the target — the version the
 * swap itself has to resolve, and published by construction while a
 * dev-built `updatedFrom` need not be — takes the slot older pnpm still
 * reads. Both exemptions come from the manifest, not from `pnpm-lock.yaml`:
 * a profile whose manifest and lockfile diverged keeps the lockfile's entry
 * unexempted. The 11.7.x `--frozen-lockfile` policy check reads that first
 * entry only, so a two-entry list does not clear it there; the `pnpm add`
 * path `/update` runs resolves the target and does pass.
 *
 * @param profile - The dsh profile whose workspace file is seeded.
 * @param version - The update target (exact version).
 * @param alsoExempt - Optional second version to keep exempt, normally the
 *   pre-update `updatedFrom`; ignored when empty or equal to `version`.
 */
export function ensureProfileReleaseAgeExclude(
  profile: string,
  version: string,
  alsoExempt?: string,
): ReleaseAgeExcludeOutcome | undefined {
  const yamlPath = profileWorkspaceYamlPath(profile)
  try {
    if (!existsSafe(dirname(yamlPath))) return undefined
    let text = ''
    try {
      text = readFileSync(yamlPath, 'utf8')
    } catch {
      // Missing file — start from an empty document; writeFileSync creates it.
    }
    const entry = `${PACKAGE_NAME}@${version}`
    const alsoEntry = alsoExempt !== undefined && alsoExempt !== '' && alsoExempt !== version
      ? `${PACKAGE_NAME}@${alsoExempt}`
      : undefined
    const keep = alsoEntry === undefined ? [entry] : [entry, alsoEntry]
    const lines = text.split(/\r?\n/u)
    let blockStart = -1
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (line !== '' && line === line.trimStart() && /^minimumReleaseAgeExclude:/u.test(line)) {
        blockStart = i
        break
      }
    }
    /** Item text of a list line, unquoted (`- 'x@1'` / `- x@1` → `x@1`). */
    const itemOf = (line: string): string => line.trim().replace(/^-\s*/u, '').replace(/^'(.*)'$/u, '$1')
    /** Foreign exclusion lines, preserved verbatim and in file order. */
    const foreignLines: string[] = []
    /** Keep-set entries already present in the block. */
    const present: string[] = []
    let droppedStale = false
    let blockEnd = -1
    if (blockStart !== -1) {
      blockEnd = blockStart + 1
      for (let i = blockStart + 1; i < lines.length; i += 1) {
        const line = lines[i]
        if (line === '' || line === line.trimStart()) break // dedent = block ends
        blockEnd = i + 1
        const item = itemOf(line)
        if (!item.startsWith(`${PACKAGE_NAME}@`)) {
          foreignLines.push(line)
        } else if (keep.includes(item)) {
          present.push(item)
        } else {
          // Own entries for older targets: dropped (no accumulation).
          droppedStale = true
        }
      }
    }
    const missing = keep.filter(item => !present.includes(item))
    if (!droppedStale && missing.length === 0) {
      return { entries: [...foreignLines.map(itemOf), ...present], changed: false }
    }
    // Own entries are re-rendered in keep order (target first) instead of
    // copied as found: pnpm 11.7.x honours only the first entry per package
    // (11.21.x applies them all, order-independent), and the target is the
    // version the swap must resolve, so it takes that first slot.
    const insert = foreignLines.concat(keep.map(item => `  - '${item}'`))
    if (blockStart !== -1) {
      lines.splice(blockStart + 1, blockEnd - blockStart - 1, ...insert)
    } else {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
      lines.push('minimumReleaseAgeExclude:', ...insert)
    }
    writeFileSync(yamlPath, `${lines.join('\n')}\n`)
    return { entries: insert.map(itemOf), changed: true }
  } catch {
    return undefined
  }
}

function existsSafe(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * sharp distributes its native binaries as platform-specific optional
 * dependencies (@img/sharp-<platform> wrappers plus @img/sharp-libvips-<platform>
 * runtimes). pnpm's lockfile records EVERY platform's entry by design, and
 * some pnpm update paths materialize all of them — maintainer-group report
 * 2026-09-11: a 0.10.0 → 0.10.1 update downloaded ~90MB of win32/darwin/
 * musl/riscv64/s390x/ppc64 binaries on a linux-x64 box. The fix keeps
 * `ignoredOptionalDependencies` patterns for every OTHER platform in the
 * profile: pnpm skips ignored optionals entirely (no download, no node_modules
 * entry), while the current platform's packages — the only ones sharp loads —
 * stay untouched. These tables mirror sharp's published platform matrix; a
 * suffix sharp adds later only costs the saving for that platform, never a
 * broken install, since an unknown suffix is simply not ignored.
 */
const SHARP_WRAPPER_SUFFIXES = [
  'darwin-arm64', 'darwin-x64', 'freebsd-wasm32', 'linux-arm', 'linux-arm64',
  'linux-ppc64', 'linux-riscv64', 'linux-s390x', 'linux-x64',
  'linuxmusl-arm64', 'linuxmusl-x64',
  'win32-arm64', 'win32-ia32', 'win32-x64',
] as const
const SHARP_LIBVIPS_SUFFIXES = [
  'darwin-arm64', 'darwin-x64', 'linux-arm', 'linux-arm64',
  'linux-ppc64', 'linux-riscv64', 'linux-s390x', 'linux-x64',
  'linuxmusl-arm64', 'linuxmusl-x64',
] as const

/**
 * The @img suffix of the RUNNING platform: musl linux maps to linuxmusl, and
 * FreeBSD — which has no native @img build — maps to the only form it can load.
 * Without that mapping a FreeBSD update would ignore `@img/sharp-freebsd-wasm32`
 * and leave sharp with nothing to load.
 */
export function sharpCurrentSuffix(platform: string, cpu: string, libc: string): string {
  if (platform === 'freebsd') return 'freebsd-wasm32'
  const os = platform === 'linux' && libc === 'musl' ? 'linuxmusl' : platform
  return `${os}-${cpu}`
}

/**
 * Deliberate omission: sharp's registry matrix (0.35.3) also carries the
 * platform-agnostic `wasm32` fallback (~9MB unpacked) plus
 * `webcontainers-wasm32`. They carry no os constraint, so they resolve on
 * every platform — including architectures with no native @img build at all
 * (loong64 etc.), where wasm is the only working form. They are therefore
 * NOT ignored: updates keep downloading them, trading ~9MB for not breaking
 * sharp on fallback-only architectures.
 */

/** Patterns for every @img platform package EXCEPT the running one. */
export function ignoredSharpOptionalPatterns(platform: string, cpu: string, libc: string): string[] {
  const current = sharpCurrentSuffix(platform, cpu, libc)
  return [
    ...SHARP_WRAPPER_SUFFIXES.filter(s => s !== current).map(s => `@img/sharp-${s}`),
    ...SHARP_LIBVIPS_SUFFIXES.filter(s => s !== current).map(s => `@img/sharp-libvips-${s}`),
  ]
}

/**
 * Libc verdict for an explicit platform, so the whole matrix is testable on any
 * host. Node's report wins when present: a stray musl loader (Debian's musl
 * package, cross-compile toolchains) on a glibc system must NOT flip the
 * verdict, or the current platform's own packages would land in the ignore
 * list. The loader-path probe only answers when the report is unavailable (the
 * same fallback sharp's detect-libc uses); a non-Linux platform is always glibc.
 */
export function detectLibc(
  platform: string,
  report: { header?: { glibcVersionRuntime?: string } } | undefined,
  muslLoaderPresent: boolean,
): 'glibc' | 'musl' {
  if (platform !== 'linux') return 'glibc'
  if (report?.header?.glibcVersionRuntime !== undefined) return 'glibc'
  return muslLoaderPresent ? 'musl' : 'glibc'
}

/** The running libc, via detectLibc's precedence (report first, paths last). */
function isMuslRuntime(): boolean {
  const report = (process.report as NodeJS.ProcessReport | undefined)?.getReport() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined
  return detectLibc(
    process.platform,
    report,
    existsSafe('/lib/ld-musl-x86_64.so.1') || existsSafe('/lib/ld-musl-aarch64.so.1') || existsSafe('/etc/alpine-release'),
  ) === 'musl'
}

/** Every @img package this module's tables cover (both the wrapper and the libvips matrix). */
const SHARP_MANAGED_PATTERNS: ReadonlySet<string> = new Set([
  ...SHARP_WRAPPER_SUFFIXES.map(s => `@img/sharp-${s}`),
  ...SHARP_LIBVIPS_SUFFIXES.map(s => `@img/sharp-libvips-${s}`),
])

/**
 * The package name a list entry names, whatever spelling pnpm accepts: an
 * optional leading `-`, either quote style, and a trailing comment outside the
 * quotes. Returns undefined for a line that carries no scalar (a nested key),
 * which callers must treat as "not ours". Comparing names rather than raw
 * lines is what keeps a hand-edited block (`- "@img/sharp-…" # keep`, a blank
 * line inside the list) from being mistaken for a user entry and preserved —
 * that mistake would leave THIS platform's own package ignored.
 */
function optionalDependencyNameOf(line: string): string | undefined {
  const body = line.trim().replace(/^-\s*/u, '')
  if (body === '') return undefined
  const quote = body.startsWith("'") || body.startsWith('"') ? body[0] : undefined
  if (quote !== undefined) {
    const end = body.indexOf(quote, 1)
    return end === -1 ? undefined : body.slice(1, end)
  }
  const commentAt = body.search(/\s#/u)
  const name = (commentAt === -1 ? body : body.slice(0, commentAt)).trim()
  return name === '' ? undefined : name
}

/** What ensureProfileSharpPlatformFilter did to the profile workspace file. */
export interface SharpPlatformFilterOutcome {
  /** The foreign-platform ignore patterns the file now carries. */
  entries: string[]
  /** True when the file was written (filter added or refreshed). */
  changed: boolean
}

/**
 * Keep an `ignoredOptionalDependencies:` block in the profile's
 * pnpm-workspace.yaml listing every non-current-platform @img package, so an
 * update stops downloading the foreign-platform sharp natives. The list is
 * recomputed on every run: it is a fact about the machine running the update,
 * so a profile carried to another platform (WSL, a musl container, a new cpu)
 * gets a fresh list instead of a stale one that would skip the packages that
 * machine needs. Entries this module's own tables cover are rewritten (by
 * package name, so quoted forms, trailing comments and blank lines inside the
 * block all still refresh); every other entry — a user's `fsevents`, a name
 * sharp adds later, a user's own `@img/sharp-wasm32` exemption — is preserved
 * verbatim, same as in {@link ensureProfileAllowBuilds}. Best effort and
 * idempotent: the file is written only when the resulting block actually
 * differs, a missing `ignoredOptionalDependencies:` block is appended, and an
 * absent profile directory resolves to undefined — the update still runs, only
 * the download-size win is lost. A document this function cannot rewrite safely
 * (a flow-style value, a duplicated key, which is already invalid YAML) is left
 * untouched rather than half-rewritten. Residual caveat shared by any persisted
 * machine fact: a second platform using the same profile without running an
 * update keeps this platform's list, so its own binaries stay skipped until the
 * next update there.
 */
export function ensureProfileSharpPlatformFilter(profile: string): SharpPlatformFilterOutcome | undefined {
  const yamlPath = profileWorkspaceYamlPath(profile)
  try {
    if (!existsSafe(dirname(yamlPath))) return undefined
    let text = ''
    try {
      text = readFileSync(yamlPath, 'utf8')
    } catch {
      // Missing file — start from an empty document; writeFileSync creates it.
    }
    const lines = text === '' ? [] : text.split(/\r?\n/u)
    let blockStart = -1
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (line === '' || line !== line.trimStart() || !/^ignoredOptionalDependencies:/u.test(line)) continue
      // A value on the key line itself (flow style `[a, b]`) is a list this
      // block rewriter would duplicate rather than refresh, and a second such
      // key is already invalid YAML — leave both alone, losing only the saving.
      const rest = line.slice(line.indexOf(':') + 1).trim()
      if ((rest !== '' && !rest.startsWith('#')) || blockStart !== -1) return undefined
      blockStart = i
    }
    const foreign: string[] = []
    let blockEnd = blockStart === -1 ? -1 : blockStart + 1
    if (blockStart !== -1) {
      for (let i = blockStart + 1; i < lines.length; i += 1) {
        const line = lines[i]
        if (line.trim() === '') continue // blank lines inside a block list don't end it
        if (line === line.trimStart()) break // dedent = block ends
        blockEnd = i + 1
        const name = optionalDependencyNameOf(line)
        // Entries from our own tables (possibly computed for another platform)
        // are dropped here and recomputed below; everything else is preserved.
        if (name === undefined || !SHARP_MANAGED_PATTERNS.has(name)) foreign.push(line)
      }
    }
    const patterns = ignoredSharpOptionalPatterns(process.platform, process.arch, isMuslRuntime() ? 'musl' : 'glibc')
    const insert = foreign.concat(patterns.map(p => `  - '${p}'`))
    if (blockStart !== -1 && lines.slice(blockStart + 1, blockEnd).join('\n') === insert.join('\n')) {
      return { entries: patterns, changed: false }
    }
    if (blockStart !== -1) {
      lines.splice(blockStart + 1, blockEnd - blockStart - 1, ...insert)
    } else {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
      lines.push('ignoredOptionalDependencies:', ...insert)
    }
    writeFileSync(yamlPath, `${lines.join('\n')}\n`)
    return { entries: patterns, changed: true }
  } catch {
    return undefined
  }
}

/**
 * The pnpm Windows tmp-rename race signature (issue #225): pnpm swaps a
 * package directory via a `<name>_tmp_<pid>` staging dir, and a file lock or
 * AV scan makes the scandir/rename fail with ENOENT/EPERM/EBUSY. The failure
 * is transient — the identical command succeeds on retry — but the crashed
 * run leaves a half-updated profile (manifest pins the old version while the
 * lockfile already carries the new snapshot), which presents as "update did
 * nothing" (#209). Genuine resolution errors never carry the `_tmp_<pid>`
 * token, so matching both keeps the retry from masking real failures.
 */
export function isTransientUpdateFailure(stderr: string): boolean {
  return /ENOENT|EPERM|EBUSY/i.test(stderr) && /_tmp_\d+/i.test(stderr)
}

/**
 * The pnpm Linux flavor of the tmp-rename race (issue #479): the very same
 * `importPackage` staging path, but overlayfs surfaces the second swap of an
 * already-replaced package dir as EEXIST — deterministically, on every run,
 * never transiently. A plain retry of the identical command ALWAYS fails the
 * same way (the leftover `_tmp_<pid>_<threadId>` staging dir keeps colliding),
 * so this signature must route to the recovery path
 * (removeStalePackageInstall + rerun), not to the plain retry.
 */
export function isEexistTmpRenameFailure(stderr: string): boolean {
  return /EEXIST/i.test(stderr) && /_tmp_\d+/i.test(stderr)
}

/**
 * The dsh profile layout places plugin packages under
 * `$DSH_HOME ?? ~/.dsh` — the same root dsh itself resolves
 * (`dshHomePath is $DSH_HOME ?? ~/.dsh`, and packaged presets resolve
 * identically). /update's recovery path needs this location to clear a
 * half-updated install pnpm can no longer swap in place (issue #479).
 */
export function profilePackageDir(profile: string): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'profiles', profile, 'node_modules', PACKAGE_NAME)
}

/** What removeStalePackageInstall actually cleared from disk. */
export interface StaleInstallRemoval {
  /**
   * `removed` — the package dir (or its junction/symlink link) is gone;
   * `absent` — it was not there to begin with (custom profile roots just
   * miss); `failed` — an error other than ENOENT blocked the removal.
   */
  packageDir: 'removed' | 'absent' | 'failed'
  /** Leftover pnpm staging dirs (`dsh-tui_tmp_<pid>_<threadId>`) removed. */
  tmpDirs: string[]
}

/**
 * Recovery for the pnpm tmp-rename races (issues #225/#479): remove the
 * profile's installed copy of this package plus the sibling `_tmp_`
 * staging dirs a crashed swap leaves behind, so the next installer run
 * takes the fresh-install path instead of renaming over the collision.
 * Field-verified workaround (issue #479): `rm -rf <pkg dir>` + rerun
 * succeeds where ten plain retries fail.
 *
 * A junction/symlink at the package dir is UNLINKED only — the link is
 * removed, the target tree (a dev checkout it may point at) is never
 * traversed or deleted. Best effort throughout: this runs inside a
 * failure-recovery branch, so an unusable result simply falls through to
 * the rerun and the manual repair hint.
 */
export function removeStalePackageInstall(profile: string): StaleInstallRemoval {
  const pkgDir = profilePackageDir(profile)
  const scopeDir = dirname(pkgDir)
  const removal: StaleInstallRemoval = { packageDir: 'absent', tmpDirs: [] }
  try {
    const stats = lstatSync(pkgDir)
    // lstat reports junctions AND symlinks as isSymbolicLink — remove the
    // link itself, never what it points at.
    if (stats.isSymbolicLink() || stats.isDirectory()) {
      rmSync(pkgDir, { recursive: true, force: true })
      removal.packageDir = 'removed'
    }
  } catch (error) {
    removal.packageDir = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'failed'
  }
  try {
    for (const name of readdirSync(scopeDir)) {
      if (!/^dsh-tui_tmp_\d+_\d+$/.test(name)) continue
      const staging = join(scopeDir, name)
      try {
        rmSync(staging, { recursive: true, force: true })
        removal.tmpDirs.push(name)
      } catch {
        // Staging leftovers are best effort; the package dir removal is
        // the load-bearing half of the recovery.
      }
    }
  } catch {
    // Unreadable scope dir — nothing more to clear.
  }
  return removal
}

/**
 * Best-effort migrate the GLOBAL launcher to the delegating shim (0.8.7):
 * after a successful profile update, copy this package's `bin/dsh-tui.js`
 * and `package.json` over the global install so the launcher can never lag
 * the profile again — the shim delegates all logic to the profile copy it
 * just updated. Single-file-safe by contract: the new bin imports nothing
 * from lib/ (see its header), so overwriting it inside an older global
 * install cannot dangle a missing helper.
 *
 * Locating the global dir relies on argv[1] being the global `dsh-tui.js`
 * (true when booted through the `dsh-tui` command). Source checkouts and
 * direct `dsh --profile` boots resolve nothing — the migration is a silent
 * no-op there. Write failures (permissions, locked files) are equally
 * silent: the launcher-alignment warning remains the fallback diagnosis.
 *
 * @returns true when the global launcher files were replaced.
 */
export function migrateGlobalLauncher(): boolean {
  const launcherBin = process.argv[1]
  if (launcherBin === undefined || !launcherBin.endsWith('dsh-tui.js')) return false
  // Walk up from the bin to the containing package; accept it only when it
  // is OUR package and not the profile copy we are running from (junction
  // layouts collapse both onto the same real path — copying onto ourselves
  // would be a no-op at best).
  let dir = dirname(resolve(launcherBin))
  const ownDir = dirname(dirname(fileURLToPath(import.meta.url)))
  for (let depth = 0; depth < 4; depth++) {
    const manifest = join(dir, 'package.json')
    try {
      const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
      if (
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        && (parsed as Record<string, unknown>).name === PACKAGE_NAME
      ) {
        let same = false
        try {
          same = realpathSync(dir) === realpathSync(ownDir)
        } catch {
          same = resolve(dir) === resolve(ownDir)
        }
        if (same) return false
        // tmp + rename keeps each file atomic; a crash mid-migration leaves
        // either the old or the new file, never a truncated one.
        const replace = (target: string, source: string): void => {
          const staged = `${target}.dsh-tui-migrate`
          writeFileSync(staged, readFileSync(source))
          renameSync(staged, target)
        }
        replace(join(dir, 'bin', 'dsh-tui.js'), join(ownDir, 'bin', 'dsh-tui.js'))
        replace(manifest, join(ownDir, 'package.json'))
        return true
      }
    } catch {
      // Unreadable manifest at this level — keep walking up.
    }
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
  return false
}

/** Outcome of the install-only half of an update (no restart). */
export interface TuiUpdateOutcome {
  /** 0 = the profile now runs the intended version; non-zero = failed. */
  code: number
  /** Version installed before the update ran (the #307 stamp). */
  updatedFrom: string
  /** Version installed after the update ran, when readable. */
  installed?: string
}

/**
 * Install-only half of `/update`: run `dsh plugin add`, refuse boot-deadlock
 * targets, verify the profile actually advanced, and migrate the global
 * launcher. No restart — `updateTuiAndRestart` layers the session-preserving
 * restart on top, and the `dsh-tui update` CLI stops here.
 *
 * @param profile - The dsh profile to update.
 * @param targetVersion - Exact version from the preflight registry check, or
 *   undefined when that check failed and pnpm should resolve latest.
 * @returns The update exit code plus the before/after versions.
 */
export async function updateTui(
  profile: string,
  targetVersion?: string,
): Promise<TuiUpdateOutcome> {
  // Stamp the pre-update version BEFORE pnpm runs: it reads this package's
  // manifest from disk, which the update replaces on the fly — a
  // post-update read already sees the NEW version, and the restarted
  // process then compares new-vs-new and false-alarms "version did not
  // advance" on every successful update (issue #307's screenshots).
  const updatedFrom = installedTuiVersion() ?? ''

  const dsh = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
  const updateArgs = tuiUpdatePluginArgs(profile, targetVersion)
  // pnpm ≥11 hard-fails installs whose dependency tree carries un-allowlisted
  // build scripts (ERR_PNPM_IGNORED_BUILDS). The host's pi-ai adapter pulls in
  // postinstall-only deps (@google/genai/protobufjs), so pre-seed
  // the profile workspace with explicit `false` entries before pnpm runs.
  const allowBuilds = ensureProfileAllowBuilds(profile)
  if (allowBuilds !== undefined && allowBuilds.added.length > 0) {
    process.stderr.write(
      `dsh-tui: pre-seeded profile pnpm allowBuilds (${allowBuilds.added.join(', ')}) — ` +
        'postinstall-only deps are explicitly ignored\n',
    )
  }
  // Foreign-platform @img/sharp-* optionals are pure download waste (~90MB on
  // the maintainer-group report); keep the profile's ignore list matching THIS
  // machine (each update recomputes it) so pnpm never fetches them.
  const sharpFilter = ensureProfileSharpPlatformFilter(profile)
  if (sharpFilter !== undefined && sharpFilter.changed) {
    process.stderr.write(
      `dsh-tui: sharp platform filter updated (${sharpFilter.entries.length} foreign-platform patterns ignored) — ` +
        `this profile's install keeps only the current platform's natives\n`,
    )
  }
  // pnpm ≥11's minimumReleaseAge (24h by default) refuses installs of
  // packages published within the window — on release day that gate rejects
  // the exact version /update pins, surfacing as a failed update that heals
  // itself a day later. Two releases inside the window (issue #1205) trip the
  // same gate on the OLD lockfile entry pnpm verifies before the swap, so
  // both the target and the still-installed updatedFrom are exempted.
  if (targetVersion !== undefined) {
    const releaseAge = ensureProfileReleaseAgeExclude(
      profile,
      targetVersion,
      updatedFrom === '' ? undefined : updatedFrom,
    )
    if (releaseAge !== undefined && releaseAge.changed) {
      const exempted = updatedFrom !== '' && updatedFrom !== targetVersion
        ? `${PACKAGE_NAME}@${targetVersion} + ${PACKAGE_NAME}@${updatedFrom}`
        : `${PACKAGE_NAME}@${targetVersion}`
      process.stderr.write(
        `dsh-tui: pre-seeded profile release-age exclusion (${exempted}) — ` +
          'freshly published versions install without the 24h supply-chain delay\n',
      )
    }
  }
  let updateStderr = ''
  const capture = (chunk: string): void => { updateStderr += chunk }
  let updateCode = await runProcess(dsh, updateArgs, { shell: true, onStderr: capture })
  // Transient Windows tmp-rename race (issue #225): retry the identical
  // command once — it succeeds on a clean second run, and only the
  // `_tmp_<pid>` race signature qualifies, never a real resolution error.
  if (updateCode !== 0 && isTransientUpdateFailure(updateStderr)) {
    process.stderr.write('dsh-tui: transient pnpm failure (Windows tmp-rename race) — retrying once…\n')
    updateStderr = ''
    updateCode = await runProcess(dsh, updateArgs, { shell: true, onStderr: capture })
  }
  // Deterministic Linux tmp-rename race (issue #479): EEXIST never clears on
  // a plain retry (the staging-dir collision reproduces every run), and a
  // transient retry that failed again means the same leftover state. Both
  // recover by removing the stale install + staging dirs, then rerunning —
  // the field-verified workaround that takes pnpm down its fresh-install
  // path instead of renaming over the collision.
  if (updateCode !== 0 && (isEexistTmpRenameFailure(updateStderr) || isTransientUpdateFailure(updateStderr))) {
    const flavor = isEexistTmpRenameFailure(updateStderr) ? 'EEXIST, issue #479' : 'retry failed, issue #225'
    const removal = removeStalePackageInstall(profile)
    const stagingNote = removal.tmpDirs.length > 0 ? ` + ${removal.tmpDirs.length} staging dir(s)` : ''
    process.stderr.write(
      `dsh-tui: pnpm tmp-rename race (${flavor}) — cleared the stale install ` +
        `(package dir: ${removal.packageDir}${stagingNote}) and rerunning the update…\n`,
    )
    updateStderr = ''
    updateCode = await runProcess(dsh, updateArgs, { shell: true, onStderr: capture })
  }
  if (updateCode !== 0) return { code: updateCode, updatedFrom }

  // A --latest fallback (preflight failed) on a stale mirror can still land
  // on the 0.7.0–0.7.1 hard-inject range — restarting into it under an older
  // global-launcher patch is the permanent boot deadlock of issues
  // #183/#307. Refuse the restart when the version JUST moved there; a user
  // who was already on it keeps their restart (their combo demonstrably
  // boots) and gets the repair hint on the next /update instead.
  const installedNow = installedTuiVersion()
  if (installedNow !== undefined && installedNow !== updatedFrom && isBootDeadlockTarget(installedNow)) {
    process.stderr.write(
      `dsh-tui: update landed on ${installedNow}, which can permanently deadlock boot under older launcher patches ` +
        `(#183/#307) — NOT restarting into it. Repair with:\n` +
        `  dsh plugin --profile ${profile} add ${PACKAGE_NAME}@latest\n` +
        `(if the mirror has not synced the latest release yet, retry later)\n`,
    )
    return { code: 1, updatedFrom, installed: installedNow }
  }

  // Post-update verification (issue #225): pnpm can report success yet leave
  // the profile half-updated (manifest old / lockfile new). Verify against
  // the preflight target; a full `install` reconciles lockfile →
  // node_modules, and if the mismatch survives, stop before restarting into
  // a mixed state and hand the user the exact repair command instead.
  if (targetVersion !== undefined) {
    let installed = installedTuiVersion()
    if (installed !== targetVersion) {
      await runProcess(dsh, ['plugin', '--profile', profile, 'install'], { shell: true })
      installed = installedTuiVersion()
    }
    if (installed !== targetVersion) {
      process.stderr.write(
        `dsh-tui: update completed but the profile still runs ${installed ?? 'an unreadable version'} ` +
          `(expected ${targetVersion}) — the profile is half-updated. Repair manually with:\n` +
          `  dsh plugin --profile ${profile} add ${PACKAGE_NAME}@${targetVersion}\n`,
      )
      return { code: 1, updatedFrom, installed }
    }
  }

  // Launcher migration (0.8.7): the freshly installed profile carries the
  // delegating shim — stamp it over the global launcher so this is the LAST
  // time the outer copy can lag. Best-effort; the alignment warning stays as
  // the fallback when the copy is impossible.
  if (migrateGlobalLauncher()) {
    process.stderr.write('dsh-tui: global launcher aligned to the delegating shim (no manual npm i -g needed anymore).\n')
  }

  return { code: 0, updatedFrom, installed: installedTuiVersion() }
}

/**
 * Update the installed dsh-tui package and restart the same launcher while
 * preserving the active session. The TUI must already be unmounted before
 * this is called so pnpm output cannot corrupt the rendered terminal frame.
 *
 * When the preflight registry check resolved an exact target, pass that
 * version to pnpm instead of resolving `latest` a second time. This avoids a
 * stale mirror/dist-tag response between the check and install. If preflight
 * failed, retain the `--latest` fallback: a plain `pnpm update` stays inside
 * the manifest range and can restart unchanged across minor releases.
 *
 * @param sessionId - Session to resume in the replacement process.
 * @param profile - The dsh profile this TUI was launched with; updating any
 *   other profile would leave the running install untouched.
 * @param targetVersion - Exact version returned by the preflight registry
 *   check, or undefined when that check failed and pnpm should resolve latest.
 * @param kernel - The kernel this process runs (TuiRestartOptions.kernel).
 * @returns Exit codes for the update run and the replacement process.
 */
export async function updateTuiAndRestart(
  sessionId: string,
  profile: string,
  targetVersion?: string,
  kernel?: KernelBackendId,
): Promise<TuiUpdateResult> {
  const outcome = await updateTui(profile, targetVersion)
  const { updatedFrom } = outcome
  if (outcome.code !== 0) return { updateCode: outcome.code, restartCode: outcome.code }

  // Restart through the same hardened handoff as /restart (issues
  // #284/#307/#483): wait for the replacement's natural exit (the outer
  // interpreter must not reclaim the console under it), re-assert the
  // stdin detach from a watchdog so a revived pump cannot swallow the
  // child's keypresses, and capture a fast-death stderr report. The old
  // plain inherit spawn raced the interpreter for input on Windows
  // Terminal (issue #483: "cannot type anything after /update").
  const restartCode = await restartTui(sessionId, {
    env: { [UPDATED_FROM_ENV]: updatedFrom },
    kind: 'update',
    ...(kernel === undefined ? {} : { kernel }),
  })
  return { updateCode: 0, restartCode }
}

/**
 * Headless `dsh-tui update`: the `/update` decision flow (preflight, deadlock
 * refusal, mirror-lag note, `--latest` fallback) followed by the install-only
 * half — no TUI, no restart. The bin launcher dynamic-imports this from the
 * profile copy's compiled lib.
 *
 * @param profile - The dsh profile to update.
 * @returns Process exit code: 0 on success or already-latest, 1 otherwise.
 */
export async function cliUpdate(profile: string): Promise<number> {
  const target = await resolveTuiUpdateTarget()
  if (target.kind === 'latest') {
    process.stdout.write(`dsh-tui: already the latest version (${target.current}).\n`)
    return 0
  }
  let targetVersion: string | undefined
  if (target.kind === 'update') {
    // Mirror the /update flow exactly: refuse the 0.7.0–0.7.1 hard-inject
    // range (permanent boot deadlock under older launcher patches, #183/#307)
    // instead of installing it.
    if (isBootDeadlockTarget(target.latest)) {
      process.stderr.write(
        `dsh-tui: refusing to update onto ${target.latest} — that range can permanently deadlock boot ` +
          `(#183/#307). Latest on the official registry: ${target.authoritative ?? target.latest}. ` +
          `If you use a mirror, retry after it syncs.\n`,
      )
      return 1
    }
    if (target.authoritative !== undefined) {
      process.stdout.write(
        `dsh-tui: note — your registry serves ${target.latest} while npmjs.org has ${target.authoritative} (mirror lag).\n`,
      )
    }
    targetVersion = target.latest
    process.stdout.write(`dsh-tui: updating ${target.current} → ${target.latest}…\n`)
  } else {
    process.stdout.write('dsh-tui: version check failed (offline or unreadable install) — falling back to `--latest`.\n')
  }
  const outcome = await updateTui(profile, targetVersion)
  if (outcome.code === 0) {
    // A preflight-less run (`--latest` fallback) can "succeed" as a pnpm
    // no-op: same manifest before and after. Say so instead of printing a
    // vacuous `updated X → X` — the /update path surfaces the same state via
    // the DSH_TUI_UPDATED_FROM stamp on restart.
    if (targetVersion === undefined && outcome.installed !== undefined && outcome.installed === outcome.updatedFrom) {
      process.stdout.write(
        `dsh-tui: version did not advance (still ${outcome.installed}) — already the latest, or the registry has no newer release yet.\n`,
      )
    } else {
      process.stdout.write(
        `dsh-tui: updated ${outcome.updatedFrom || '(unknown)'} → ${outcome.installed ?? '(unreadable)'}.\n`,
      )
    }
  }
  return outcome.code
}

/**
 * Release the shared console for the replacement without resetting it.
 *
 * A pty's termios is per-DEVICE: destroying this stream would write this
 * process's saved cooked/ECHO mode back over the replacement's raw mode
 * (libuv restores orig_termios on tty close; verified on Node 24 — mouse
 * reports then echo as `^[[<…M` and keys wait for a newline). Detaching —
 * no readers, paused, unref'd — keeps the mode untouched.
 *
 * Two deliberate trade-offs vs the old destroy():
 * - destroy() doubled as a permanent gate ("a destroyed stream can never be
 *   resumed"). Readers removed + paused already keep this process out of the
 *   console's key path (#284/#307), and after the handoff only the
 *   child-exit listener remains here — nothing re-attaches a reader.
 * - On exit Node still writes the saved cooked mode back once (atexit
 *   uv_tty_reset_mode). Fine in the normal order — this process outlives the
 *   replacement, and the shell wants cooked back anyway; it only bites if
 *   this process dies while the replacement is still running.
 *
 * @param stdin - Console stream to detach; injectable for the regression.
 */
export function detachHandoffStdin(
  stdin: Pick<NodeJS.ReadStream, 'removeAllListeners' | 'pause' | 'unref'> = process.stdin,
): void {
  stdin.removeAllListeners('readable')
  stdin.removeAllListeners('data')
  stdin.pause()
  stdin.unref()
}

/**
 * Restart the running TUI in place and resume the active session — the
 * `/update` restart path minus the pnpm step, for `/restart`. Spawns the
 * same node process with the original argv and the dual-written resume
 * contract, so a fresh process re-boots the same profile and attaches the
 * same session. No installation is touched, so it works on any launch
 * (profile, source checkout, `--config` overlay). `/update` reuses this
 * handoff for its own restart tail (`kind: 'update'`): the keyboard-race
 * hardening below is exactly the failure its users reported (issue #483:
 * update restarts into a TUI that takes no input).
 *
 * The TUI must already be unmounted before this is called (same terminal
 * handoff contract as `updateTuiAndRestart`): the caller runs this from the
 * exit funnel's done callback, after finishExit detached the terminal and
 * the readable stdin pump.
 *
 * This waits for the replacement's natural exit: the outer command
 * interpreter that ran `dsh-tui` reclaims the console the moment the
 * launch chain (cmd → wrapper → this process) unwinds, and an orphaned
 * replacement still attached to the console then fights the interpreter's
 * own prompt and line reader for every keypress (field evidence
 * 2026-08-24: healthy child mounted the UI, the old process exited on a
 * 4s survival timer, the interpreter printed its prompt over the TUI and
 * the DA response bytes landed on the prompt line). Waiting is safe
 * because finishExit already paused and unref'd this process's stdin —
 * the child is the console's only key reader (issues #284/#307).
 *
 * The 4s survival window remains a DIAGNOSIS marker only: a replacement
 * that dies within it never painted the TUI, and its captured stderr is
 * reported synchronously (a raw inherit write can vanish mid-handoff). A
 * late exit is quiet — by then the user owned a working TUI session.
 *
 * @param sessionId - Session to resume in the replacement process (ignored
 *   when `options.backend` switches kernels — the new backend starts a
 *   fresh session).
 * @param options - `kind: 'update'` drops the /restart boot-diagnosis
 *   marker and tags restart.log events for the update flow; `env` adds
 *   marker variables for the replacement (e.g. DSH_TUI_UPDATED_FROM);
 *   `backend` switches the replacement onto that kernel.
 * @returns 0 when the replacement ran and exited cleanly, 127 when it
 *   failed to start, otherwise the child's own exit code.
 */
export interface TuiRestartOptions {
  /** Extra env markers for the replacement process (/update's stamp). */
  env?: Record<string, string>
  /**
   * 'update' reuses this handoff after an install: no
   * DSH_TUI_RESTART_CHILD marker (that flag is /restart-only boot
   * diagnostics) and restart.log events carry the update-restart tag.
   */
  kind?: 'restart' | 'update'
  /**
   * A kernel switch from the launchpad selector. restart.log events use the
   * backend-switch tag; the replacement gets DSH_TUI_BACKEND and the one-shot
   * KERNEL_SWITCH_HANDOFF_ENV set to the chosen kernel (the latter beats a
   * Config row that pins the other one), and no DSH_TUI_RESUME_SESSION: the
   * new kernel starts a new session.
   */
  backend?: KernelBackendId
  /**
   * 'alt' (fullscreen kernel switch only): this process keeps the alternate
   * screen open through the spawn, the replacement adopts it without a
   * second 1049h, and its first flushed frame (ACKed on fd 3) hands the
   * screen over; see src/handoffAck.ts. /restart, /update and inline
   * sessions go back to the main screen before the spawn as before.
   */
  handoffScreen?: 'alt'
  /**
   * The kernel this process runs. A plain /restart or /update passes it in
   * the one-shot KERNEL_SWITCH_HANDOFF_ENV so the replacement reopens the
   * session on the same kernel even when a Config row names the other one
   * (as it does after a kernel switch). Ignored when `backend` is set.
   */
  kernel?: KernelBackendId
}

/**
 * The replacement's env, pure: the resume marker, the /restart child stamp,
 * the caller's extra markers and the kernel-switch overrides. Exported for
 * scripts/verify-launchpad, which feeds it through the boot resolver.
 */
export function restartChildEnv(
  parentEnv: NodeJS.ProcessEnv,
  sessionId: string,
  kind: 'restart' | 'update',
  options: TuiRestartOptions,
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    ...parentEnv,
    // The replacement resumes the current session through the launcher
    // contract (DSH_TUI_RESUME_SESSION; see src/sessionHistory.ts).
    DSH_TUI_RESUME_SESSION: sessionId,
    // Marks the replacement so its own boot logs to restart.log without
    // noisy logging on every ordinary launch (/restart only).
    ...(kind === 'restart' ? { [RESTART_CHILD_ENV]: '1' } : {}),
    ...options.env,
  }
  // A stale handoff override never leaks into a plain replacement: the var is
  // one-shot (consumed at this process's own boot), and a child that is NOT
  // switching kernels keeps this process's kernel by config/env/memory as
  // usual.
  delete childEnv[KERNEL_SWITCH_HANDOFF_ENV]
  // Same for the alt-screen handoff markers: a replacement must not adopt a
  // screen or ACK pipe from an earlier attempt. restartTui sets them again
  // when it opens a handoff.
  delete childEnv[HANDOFF_SCREEN_ENV]
  delete childEnv[HANDOFF_ACK_FD_ENV]
  delete childEnv[HANDOFF_ATTEMPT_ENV]
  if (options.backend === undefined && options.kernel !== undefined) childEnv[KERNEL_SWITCH_HANDOFF_ENV] = options.kernel
  if (options.backend !== undefined) {
    childEnv.DSH_TUI_BACKEND = options.backend
    // DSH_TUI_BACKEND alone loses to a Config row (config > env > memory),
    // so the switch also sets the one-shot variable that ranks above config.
    childEnv[KERNEL_SWITCH_HANDOFF_ENV] = options.backend
    // A kernel switch never resumes: the id of THIS backend's session means
    // nothing to the next one, and an inherited marker (this process may
    // itself be a /restart child) would send the new kernel looking for it —
    // deleted outright, not blanked (the launcher row maps '' to
    // config.sessionId='', not to "absent").
    delete childEnv.DSH_TUI_RESUME_SESSION
  }
  return childEnv
}

export async function restartTui(sessionId: string, options: TuiRestartOptions = {}): Promise<number> {
  const kind = options.kind ?? 'restart'
  const tag = options.backend !== undefined ? 'backend-switch' : kind === 'update' ? 'update-restart' : 'restart'
  // A kernel switch must not hand the replacement THIS kernel's resume
  // flags: an inherited `--resume <id>` in argv would send the new kernel
  // looking for a session that belongs to the kernel it just left — the
  // same reason DSH_TUI_RESUME_SESSION is deleted below.
  const appArgs = process.argv.slice(1)
  const argv = [...process.execArgv, ...(options.backend === undefined ? appArgs : stripResumeArgs(appArgs))]
  logRestartEvent(`${tag}: spawning replacement`, {
    node: process.execPath,
    argv,
    cwd: process.cwd(),
    stdinTty: process.stdin.isTTY === true,
    stdoutTty: process.stdout.isTTY === true,
    stderrTty: process.stderr.isTTY === true,
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    dshHome: process.env.DSH_HOME ?? null,
  })
  const startedAt = Date.now()
  // Fullscreen kernel switch: keep the alternate screen until the replacement
  // reports its first flushed frame on the ACK pipe (see handoffScreen).
  const handoff = options.handoffScreen === 'alt' && options.backend !== undefined
  const attemptId = handoff ? 'hs-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2, 8) : undefined
  // Ctrl+C while the replacement boots reaches this process too: same process
  // group, and nothing has the terminal in raw mode yet. Dying here would
  // leave behind the alternate screen this process still holds; the
  // replacement gets the same signal, and its close below restores the screen.
  const ignoreInterrupt = (): void => {}
  if (handoff) process.on('SIGINT', ignoreInterrupt)
  // "Starting X…" goes out before the spawn, waiting for the write callback
  // so it lands before the replacement draws anything.
  if (options.backend !== undefined) {
    await writeHandoffStage(
      process.stdout,
      formatHandoffNotice('stage-start', { name: kernelDisplayName(options.backend), color: process.stdout.isTTY === true }) + '\n',
    )
    logRestartEvent(handoffEventTag('stage-start'), { backend: options.backend, ...(attemptId === undefined ? {} : { attemptId }) })
  }
  return new Promise(resolve => {
    const childEnv = restartChildEnv(process.env, sessionId, kind, options)
    if (handoff) {
      // stdio[3] is the ACK pipe; the env tells the replacement its fd and the attempt id.
      childEnv[HANDOFF_SCREEN_ENV] = 'alt'
      childEnv[HANDOFF_ACK_FD_ENV] = '3'
      childEnv[HANDOFF_ATTEMPT_ENV] = attemptId!
      logRestartEvent('handoff: alt-screen bracket held for the replacement', { attemptId })
    }
    const child = spawn(process.execPath, argv, {
      env: childEnv,
      // stdin/stdout stay inherited so the replacement owns the console the
      // moment it boots; stderr is captured so a boot failure is reportable
      // through THIS process (the terminal may already be mid-handoff when
      // the child dies, and a raw inherit write can vanish). fd 3 is the
      // one-way ACK pipe (replacement → supervisor): adopted / first frame.
      stdio: handoff ? ['inherit', 'inherit', 'pipe', 'pipe'] : ['inherit', 'inherit', 'pipe'],
    })
    let ackAdoptedAt: number | undefined
    let ackReadyAt: number | undefined
    const ackStream = handoff ? (child.stdio[3] ?? undefined) as import('node:stream').Readable | undefined : undefined
    if (ackStream !== undefined) {
      ackStream.setEncoding('utf8')
      let pending = ''
      ackStream.on('data', (chunk: string) => {
        pending += chunk
        for (;;) {
          const newline = pending.indexOf('\n')
          if (newline < 0) break
          const line = pending.slice(0, newline)
          pending = pending.slice(newline + 1)
          const ack = parseHandoffAckLine(line)
          if (ack === null || ack.attemptId !== attemptId) continue
          if (ack.kind === 'adopted' && ackAdoptedAt === undefined) {
            ackAdoptedAt = Date.now()
            logRestartEvent('handoff/screen-adopted', { attemptId, backend: options.backend })
          }
          if (ack.kind === 'ready' && ackReadyAt === undefined) {
            ackReadyAt = Date.now()
            // ready means the replacement's first frame was flushed, not just
            // that it mounted or is still alive.
            logRestartEvent(handoffEventTag('first-frame'), { attemptId, backend: options.backend, elapsedMs: ackReadyAt - startedAt })
          }
        }
      })
      ackStream.on('error', () => {
        // The supervisor outlives the pipe by contract; a broken pipe here
        // means the replacement never speaks the protocol (e.g. an older
        // build) — the close handler's no-ready branch still restores the
        // screen, so the bracket can never be orphaned.
      })
      const ackWatch = setTimeout(() => {
        if (ackReadyAt === undefined) {
          logRestartEvent('handoff/first-frame watch', { attemptId, note: 'no first-frame ACK within 30s (diagnosis only, never a success/failure fact)' })
        }
      }, 30000)
      ackWatch.unref()
    }
    logRestartEvent(`${tag}: replacement spawned`, { childPid: child.pid, ...(options.backend === undefined ? {} : { backend: options.backend }) })
    // Handoff watchdog (field evidence 2026-08-24: restarted TUI mounts but
    // takes no input). Two jobs, both diagnosis-grade:
    // 1. SAMPLE this process's stdin state every second — if anything
    //    re-attaches a reader after the funnel's detachStdinForHandoff, the
    //    sample (taken before the re-assert below) shows it in the log.
    // 2. RE-ASSERT the detach — never DESTROY the stream: destroying it
    //    resets the shared pty and stomps the replacement's raw mode (see
    //    detachHandoffStdin for the mechanism and trade-offs). This process
    //    must never read the shared console again — every keypress belongs to
    //    the replacement, and a resumed pump here is exactly the "restarted
    //    TUI sees dropped or swallowed input" failure (#284/#307).
    let watchdogTicks = 0
    const watchdog = setInterval(() => {
      watchdogTicks += 1
      const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean }
      logRestartEvent('parent: stdin watchdog', {
        tick: watchdogTicks,
        readableListeners: stdin.listenerCount('readable'),
        dataListeners: stdin.listenerCount('data'),
        paused: stdin.isPaused,
        raw: stdin.isRaw === true,
        buffered: stdin.readableLength,
      })
      try {
        detachHandoffStdin(stdin)
      } catch {
        // Diagnosis/mitigation only.
      }
      if (watchdogTicks === 15) {
        clearInterval(watchdog)
        logRestartEvent('parent: stdin detached after watchdog (kept raw, not destroyed)')
      }
    }, 1000)
    watchdog.unref()
    let childStderr = ''
    let loggedStderrBytes = 0
    child.stderr?.on('data', (chunk: Buffer) => {
      childStderr += chunk.toString('utf8')
      // Mirror chunks to the log capped: the full text still reaches the
      // terminal report below, and unbounded output must not grow the file.
      if (loggedStderrBytes < 4096) {
        loggedStderrBytes += chunk.length
        logRestartEvent(`${tag}: replacement stderr`, { text: chunk.toString('utf8').slice(0, 2048) })
      }
    })
    // Diagnosis marker only — never resolves: after the window the child owns
    // the terminal, and this process must keep the launch chain open until
    // the replacement exits (see the header comment).
    const timer = setTimeout(() => {
      logRestartEvent(`${tag}: survival window passed, following the replacement until it exits`)
    }, 4000)
    timer.unref()
    child.once('error', error => {
      clearTimeout(timer)
      process.removeListener('SIGINT', ignoreInterrupt)
      logRestartEvent(`${tag}: spawn error`, { message: error.message })
      if (options.backend !== undefined) {
        // Nothing took the screen over: restore it before the notice.
        if (handoff) restoreHandoffScreen()
        // A spawn failure is a failed switch (yellow, with the safe-mode hint),
        // not a crash.
        logRestartEvent(handoffEventTag('failed'), { reason: 'spawn-error', message: error.message })
        writeHandoffNotice(
          formatHandoffNotice('failed', {
            name: kernelDisplayName(options.backend),
            reason: 'spawn-error',
            safeHint: true,
            color: process.stderr.isTTY === true,
          }) + `\n${error.message}\n`,
        )
      } else {
        writeHandoffNotice(`dsh-tui: failed to spawn the restart: ${error.message}\n`)
      }
      resolve(127)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      process.removeListener('SIGINT', ignoreInterrupt)
      const elapsedMs = Date.now() - startedAt
      logRestartEvent(`${tag}: replacement exited`, {
        code: code ?? null,
        signal: signal ?? null,
        elapsedMs,
      })
      if (options.backend !== undefined) {
        // Kernel switch outcome: success is quiet (restart.log only), a
        // replacement that never came up is a yellow failure with the session
        // kept and the safe-mode hint, and a later nonzero exit is a red
        // crash. With the ACK pipe the first frame decides which of the two
        // failures it was; see classifyReplacementOutcome.
        const outcome = classifyReplacementOutcome({
          closed: true, code, signal, elapsedMs,
          ...(handoff ? { firstFrameAcked: ackReadyAt !== undefined } : {}),
        })
        logRestartEvent(handoffEventTag(outcome.kind), {
          ...(outcome.kind === 'crashed' ? { code: outcome.code } : outcome.kind === 'failed' ? { reason: outcome.reason } : {}),
          ...(attemptId === undefined ? {} : { attemptId }),
        })
        if (outcome.kind === 'failed') {
          // Before ready this process still holds the alternate screen:
          // restore it first so the notice lands on the main screen. After
          // ready the replacement's own exit cleanup closed it.
          if (handoff && ackReadyAt === undefined) restoreHandoffScreen()
          const suffix = childStderr.trim() === '' ? '' : `\n${childStderr.trimEnd()}`
          writeHandoffNotice(
            formatHandoffNotice('failed', {
              name: kernelDisplayName(options.backend),
              reason: outcome.reason,
              safeHint: true,
              color: process.stderr.isTTY === true,
            }) + `${suffix}\n`,
          )
        } else if (outcome.kind === 'crashed') {
          // A signal death after the first frame skipped the replacement's
          // own exit cleanup, so the screen and input modes are still its.
          if (handoff && signal !== null) restoreHandoffScreen()
          writeHandoffNotice(
            '\n' + formatHandoffNotice('crashed', {
              name: kernelDisplayName(options.backend),
              code: outcome.code,
              safeHint: true,
              color: process.stderr.isTTY === true,
            }) + '\n',
          )
        }
      } else if (elapsedMs < 4000) {
        // Fast death: the TUI never came up. Synchronous stderr write —
        // process.exit() right after an async stream write skips the flush,
        // and a vanished diagnosis is indistinguishable from silent failure.
        const suffix = childStderr.trim() === '' ? '' : `\n${childStderr.trimEnd()}`
        writeHandoffNotice(
          `dsh-tui: restart child exited during the handoff (code ${code ?? 'null'}` +
            `${signal === undefined || signal === null ? '' : `, signal ${signal}`}) — the TUI did not come up.` +
            `${suffix}\nYour session is preserved; resume with the launcher or retry the command.\n`,
        )
      } else if (code !== 0 && code !== null) {
        // Late nonzero exit: the session ended abnormally, say so briefly.
        writeHandoffNotice(`\ndsh-tui: the restarted session exited with code ${code}.\n`)
      }
      resolve(code ?? 1)
    })
  })
}
