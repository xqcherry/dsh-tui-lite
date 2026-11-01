import type { ChatRow } from '../../../shared/protocol/transcript.js'
import type { Notify } from '../../../shared/protocol/notifications.js'
/**
 * Local-only transcript actions every session gets: `/clear`, local report
 * rows, `!cmd` / `!!cmd` through the session's workspace shell,
 * `/activity frames`, and the "load earlier" restore of folded rows. The
 * restore only works when the backend can slice its own durable history;
 * otherwise nothing is ever folded and the action restores 0 rows.
 */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { t } from '../../../shared/i18n.js'
import type { ChannelOwner } from '../../../shared/lifecycle/owner.js'
import { runForegroundShell, type ForegroundShell } from '../../compat/shell.js'
import type { ChannelBinding } from '../binding.js'
import { LOCAL_OUTPUT_LIMIT, preview } from '../transcript.js'

export function createCoreLocalActions(ctx: Context, deps: {
  owner: Pick<ChannelOwner, 'current'>
  binding: Pick<ChannelBinding, 'capture' | 'isCurrent'>
  cwd(): string
  resetRows(): void
  clearResponseActivity(): void
  appendLocalRow(row: ChatRow): void
  publish(): void
  rowIds: { value: number }
  resetProjection(): void
  notify: Notify
  unavailable(name: string): void
  /** Extension projections whose rows `/clear` drops with the transcript. */
  dropRows(): void
  /** Restore folded rows from the backend's durable history; absent = the
   *  backend cannot slice it (and nothing is folded). */
  loadOlder(): (() => number) | undefined
  /** An input on its way to the session (`!!`): returns its end. */
  beginInput?(): () => void
}) {
  const { owner, binding, rowIds, notify } = deps

  return {
    loadOlder(): number {
      const restore = deps.loadOlder()
      if (restore === undefined) return 0
      const restored = restore()
      if (restored > 0) deps.publish()
      return restored
    },

    clear(): void {
      deps.resetRows()
      rowIds.value = 0
      deps.resetProjection()
      deps.dropRows()
      deps.clearResponseActivity()
      deps.appendLocalRow({ id: rowIds.value++, kind: 'notice', text: t('session-cleared') })
      deps.publish()
    },

    pushLocal(title: string, lines: readonly string[]): void {
      deps.appendLocalRow({ id: rowIds.value++, kind: 'local', text: title })
      for (const line of lines) deps.appendLocalRow({ id: rowIds.value++, kind: 'local-output', text: preview(line, LOCAL_OUTPUT_LIMIT) })
      deps.publish()
    },

    /**
     * `!cmd` / `!!cmd`: the workspace's own command shell when it has one
     * (a remote workspace runs the command there), else the host shell;
     * `!!` sends the output on as a followup of the session it ran for.
     */
    async runLocalCommand(command: string, includeInContext: boolean): Promise<void> {
      // `!!` is an input from its first keystroke: `/new` must not adopt
      // over a command whose output is about to reach this session.
      const end = includeInContext ? deps.beginInput?.() : undefined
      try {
        await runLocal(command, includeInContext)
      } finally {
        end?.()
      }
    },
  }

  async function runLocal(command: string, includeInContext: boolean): Promise<void> {
    const capture = binding.capture()
    const current = (): boolean => owner.current() && binding.isCurrent(capture)
    const cwd = deps.cwd()
    deps.appendLocalRow({ id: rowIds.value++, kind: 'local', text: command, executionTarget: 'local' })
    deps.publish()
    const executor = ctx.get('shell') as ForegroundShell | undefined
    if (!current()) return
    if (executor === undefined) {
      deps.unavailable('shell')
      return
    }
    let output: string
    try {
      const result = await runForegroundShell(executor, { command, workdir: cwd, timeoutMs: 30000 })
      output = result.stdout.text.trim() || result.stderr.text.trim() || (result.timedOut ? '(timed out)' : '(no output)')
    } catch (error) {
      output = error instanceof Error ? error.message : String(error)
    }
    if (!current()) return
    deps.appendLocalRow({ id: rowIds.value++, kind: 'local-output', text: preview(output, LOCAL_OUTPUT_LIMIT) })
    deps.publish()
    if (includeInContext) {
      // This runs detached (`void runLocalCommand`): a session that closed
      // meanwhile (a backend process that exited) must not surface as an
      // unhandled rejection.
      try {
        await capture.session.submit({ text: `<bash-stdout>\n${output}\n</bash-stdout>`, clientMessageId: randomUUID() }, 'followup')
      } catch (error) {
        if (current()) notify(t('send-failed', { err: error instanceof Error ? error.message : String(error) }), { color: 'error', timeoutMs: 8000 })
      }
    }
  }
}

export type CoreLocalActions = ReturnType<typeof createCoreLocalActions>
