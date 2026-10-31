import { serializeCrashDetail, unserializableCrashDetail, type CrashDetail } from '../platform/crashDetail.js'

export function createExitFunnel(deps: { onUserExit: (error?: unknown) => void }): {
  /**
   * Settle the exit once.
   * @returns true when this call ran the user-exit path (the funnel now owns
   *  the process), false when it was already settled or the tree is being
   *  torn down. A process-level crash backstop must fall back to Node's
   *  default crash on false instead of swallowing the error.
   */
  handleExit: (error?: unknown) => boolean
  markTeardown: () => void
} {
  let exited = false
  let teardown = false
  return {
    markTeardown: () => {
      teardown = true
    },
    handleExit: (error?: unknown) => {
      if (teardown) return false
      if (exited) return false
      exited = true
      deps.onUserExit(error)
      return true
    },
  }
}

/**
 * The exit funnel's crash tail, separate so scripts/verify-shutdown-fallback
 * can drive it with failing sinks:
 *
 *  - Diagnostics (serialization and every log sink) may fail: a throwing
 *    getter or Proxy trap on the error, or a sink that throws, falls back to
 *    unserializableCrashDetail and one more logging attempt. The funnel latch
 *    is already set here, so an exception escaping would skip the rest.
 *  - The resume markers (and the last-run record, via writeResumeMarkers)
 *    and the terminal cleanup (finish, then disposeRootAndExit(1)) always
 *    run, whatever happened to the diagnostics.
 */
export interface CrashExitDeps {
  /** The crash value itself (may be hostile: throwing getters, Proxy traps). */
  readonly error: unknown
  /** Serializer override (verify fault injection); default serializeCrashDetail. */
  readonly serialize?: (error: unknown) => CrashDetail
  /** One-line error log (ctx.logger.error). */
  readonly logError: (message: string) => void
  /** crash.log append (appendCrashLog). */
  readonly appendLog: (detail: CrashDetail) => void
  /** restart.log one-line event (logRestartEvent). */
  readonly logRestart: (event: string, data?: Record<string, unknown>) => void
  /** Debug log (logForDebugging). */
  readonly logDebug: (message: string, data?: Record<string, unknown>) => void
  /** Resume markers; best effort, isolated from the diagnostics' fate. */
  readonly writeResumeMarkers: () => void
  /** MUST-RUN terminal cleanup + exit(1) handoff (finishExit + dispose). */
  readonly finish: (crashLine: string) => void
}

export function runCrashExit(deps: CrashExitDeps): void {
  let detail: CrashDetail
  try {
    detail = (deps.serialize ?? serializeCrashDetail)(deps.error)
    deps.logError(`dsh-tui: exit after error: ${detail.summary}`)
    deps.appendLog(detail)
    deps.logRestart('crash', { summary: detail.summary, ...(detail.digest === undefined ? {} : { digest: detail.digest }) })
    deps.logDebug('dsh-tui: crash detail', { crash: detail.text })
  } catch {
    // Ultimate degradation: fixed literals only — never re-read the throwable,
    // never re-run the sink chain beyond one best-effort attempt.
    detail = unserializableCrashDetail()
    try {
      deps.logError(`dsh-tui: exit after error: ${detail.summary}`)
      deps.appendLog(detail)
      deps.logRestart('crash', { summary: detail.summary })
    } catch {
      // Nothing left to try — the cleanup below still must run.
    }
  }
  try {
    deps.writeResumeMarkers()
  } catch {
    // Resume persistence is best effort and must never block the exit.
  }
  deps.finish(`dsh-tui crashed: ${detail.message}`)
}
