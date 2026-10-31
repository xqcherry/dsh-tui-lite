import instances from '../../ink/instances.js'
import { cursorMove, DISABLE_KITTY_KEYBOARD, DISABLE_MODIFY_OTHER_KEYS, DISABLE_WIN32_INPUT_MODE } from '../../ink/termio/csi.js'
import { DBP, DFE, DISABLE_MOUSE_TRACKING, EXIT_ALT_SCREEN, SHOW_CURSOR } from '../../ink/termio/dec.js'
import { CLEAR_ITERM2_PROGRESS, CLEAR_TAB_STATUS, supportsTabStatus, wrapForMultiplexer } from '../../ink/termio/osc.js'
import { removeClipboardImageDir } from '../../utils/clipboard.js'
import { render } from '../primitives.js'

type InkShutdownState = {
  detachForShutdown?: () => void
  /**
   * Full stdin detach before returning control to the shell:
   * removes the readable/data listeners and pauses the pump so the
   * closing runtime stops consuming terminal input.
   */
  detachStdinForHandoff?: () => void
  /** Drain pending stdin bytes; the exit funnel re-drains after cleanup. */
  drainStdin?: () => void
  frontFrame?: { cursor?: { x: number; y: number } }
  displayCursor?: { x: number; y: number } | null
}

/**
 * Finish terminal I/O before handing control to a process-level exit action.
 * Exported for scripts/verify-shutdown-fallback.
 */
export async function finishExit(
  ctx: { logger: { debug(message: string): void } },
  instance: Awaited<ReturnType<typeof render>> | undefined,
  fullscreen: boolean,
  notice: string | undefined,
  stderrNotice: string | undefined,
  done: () => void,
): Promise<void> {
  try {
    // Resolve the Ink runtime twice: the instances map is keyed by stdout
    // identity, so a replaced/overridden stdout misses it; the render()
    // handle is the caller's own instance and always matches (issue #522 —
    // a missed lookup skipped detachForShutdown, leaving the stdin pump,
    // TTY handlers and querier alive so the self-heal probe re-wrote
    // ENABLE_MOUSE_TRACKING after DISABLE_MOUSE_TRACKING had been sent).
    const fromMap = readInkShutdownState(instances.get(process.stdout))
    const fromHandle = instance === undefined ? undefined : readInkShutdownState(instance)
    // A handle that exposes neither detach hook is not an Ink runtime we can
    // latch (e.g. the fake render handles in shutdown regressions) — treat it
    // as a lookup miss so the full-unmount fallback below can still run.
    const runtime = fromMap ?? (
      fromHandle?.detachForShutdown === undefined && fromHandle?.detachStdinForHandoff === undefined
        ? undefined
        : fromHandle
    )
    if (runtime === undefined) {
      ctx.logger.debug('dsh-tui: Ink runtime unavailable during shutdown; using generic terminal cleanup')
      if (instance !== undefined) {
        ctx.logger.debug('dsh-tui: Ink shutdown using full unmount as the terminal-restore fallback')
        // Lookup-miss (custom stdout embedders / detach-less handles): the
        // registry cannot hand us the detach hooks, so run the full Ink
        // unmount first. It restores raw mode, alt screen and listeners
        // synchronously before the notice below is written — the process
        // must never hand a broken terminal back to the shell.
        try {
          instance.unmount()
        } catch {
          ctx.logger.debug('dsh-tui: Ink shutdown unmount fallback failed; continuing with generic terminal cleanup')
        }
      }
    } else if (fromMap === undefined) {
      ctx.logger.debug('dsh-tui: Ink runtime resolved from the render handle (instances map missed); detaching')
    }
    const cursor = fullscreen ? '' : cursorMoveToFrameEnd(runtime)

    try {
      runtime?.detachForShutdown?.()
      // Stop reading terminal bytes before returning to the shell.
      runtime?.detachStdinForHandoff?.()
    } catch {
      ctx.logger.debug('dsh-tui: Ink shutdown detach failed; continuing with generic terminal cleanup')
    }
    const exitAlt = fullscreen ? EXIT_ALT_SCREEN : ''
    const cleanup = [
      exitAlt,
      cursor,
      DISABLE_MOUSE_TRACKING,
      DISABLE_MODIFY_OTHER_KEYS,
      DISABLE_KITTY_KEYBOARD,
      DISABLE_WIN32_INPUT_MODE,
      DFE,
      DBP,
      SHOW_CURSOR,
      CLEAR_ITERM2_PROGRESS,
      supportsTabStatus() ? wrapForMultiplexer(CLEAR_TAB_STATUS) : '',
    ].join('')
    const suffix = notice === undefined ? '' : `${notice}\n`
    await writeStream(process.stdout, `${cleanup}\r\n${suffix}`)
    // Re-drain AFTER the cleanup sequences have landed (#507): terminal
    // replies and mouse packets already in flight when the exit started
    // keep arriving while cleanup is being written — the detach-time drain
    // cannot see them. Unconsumed at process exit they land in the shell's
    // input queue (DECRPM/DA1/XTVERSION garbage pasted into the prompt).
    // 150ms settle covers reply RTT on slow links (ssh/ghostty is #522's
    // environment; 50ms proved too tight there) while staying well inside
    // the exit window the user already waits through.
    await new Promise<void>(resolve => setTimeout(resolve, 150))
    runtime?.drainStdin?.()
    if (stderrNotice !== undefined) {
      await writeStream(process.stderr, `\n${stderrNotice}\n`)
    }
  } catch {
    ctx.logger.debug('dsh-tui: terminal cleanup failed; continuing with process shutdown')
  }
  // Filesystem-only: the exported clipboard images live in a per-process
  // temp directory that nothing else removes.
  removeClipboardImageDir()
  done()
}

function readInkShutdownState(value: unknown): InkShutdownState | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  if (candidate.detachForShutdown !== undefined && typeof candidate.detachForShutdown !== 'function') return undefined
  if (candidate.detachStdinForHandoff !== undefined && typeof candidate.detachStdinForHandoff !== 'function') return undefined
  if (candidate.drainStdin !== undefined && typeof candidate.drainStdin !== 'function') return undefined
  if (candidate.frontFrame !== undefined && !isFrameState(candidate.frontFrame)) return undefined
  if (candidate.displayCursor !== undefined && candidate.displayCursor !== null && !isCursorState(candidate.displayCursor)) return undefined
  return value as InkShutdownState
}

function isFrameState(value: unknown): value is { cursor?: { x: number; y: number } } {
  if (value === null || typeof value !== 'object') return false
  const cursor = (value as Record<string, unknown>).cursor
  return cursor === undefined || isCursorState(cursor)
}

function isCursorState(value: unknown): value is { x: number; y: number } {
  if (value === null || typeof value !== 'object') return false
  const cursor = value as Record<string, unknown>
  return typeof cursor.x === 'number' && typeof cursor.y === 'number'
}

function cursorMoveToFrameEnd(runtime: InkShutdownState | undefined): string {
  const frame = runtime?.frontFrame?.cursor
  if (frame === undefined) return ''
  const parked = runtime?.displayCursor ?? frame
  return cursorMove(frame.x - parked.x, frame.y - parked.y)
}

function writeStream(stream: NodeJS.WriteStream, data: string): Promise<void> {
  if (data.length === 0) return Promise.resolve()
  return new Promise(resolve => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    const timer = setTimeout(finish, 1000)
    timer.unref()
    try {
      stream.write(data, () => {
        clearTimeout(timer)
        finish()
      })
    } catch {
      clearTimeout(timer)
      finish()
    }
  })
}
