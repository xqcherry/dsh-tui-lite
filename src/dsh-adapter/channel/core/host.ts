import { publishRuntime } from '../../module-runtime.js'
import type { ModuleOwners } from '../../module-runtime.js'
import type { Context } from '@deepseek-ai/cordis'
import type { ChannelOwner } from '../../../shared/lifecycle/owner.js'
import { runForegroundShell, type ForegroundShell } from '../../compat/shell.js'

/**
 * Statusline breadcrumb: the current git branch of the session cwd
 * (best-effort, through the host `shell` service). Re-run when an adoption
 * lands on a different cwd (/resume, /workspace, issue #96) so the
 * breadcrumb never shows the previous workspace's branch.
 */
export function createGitBranchRefresher(ctx: Context, deps: {
  owner: Pick<ChannelOwner, 'current'>
  state: Pick<ModuleOwners, 'sessions' | 'transcript' | 'publication'>
  /** Record the resolved branch against the bound session (the session
   *  browser's branch column); absent = nothing records it. */
  noteBranch?(branch: string): void
}): () => void {
  return () => {
    const { state } = deps
    state.sessions.ingress.update(draft => { draft.gitBranch = undefined })
    const shell = ctx.get('shell') as ForegroundShell | undefined
    if (!shell) return
    // Capture the requested cwd: a /resume landing while this query is in
    // flight refreshes the branch for the new cwd, so a late reply from the
    // old workspace must be dropped (stale statusline, issue #96).
    const requestedCwd = state.sessions.ingress.read().cwd
    void runForegroundShell(shell, {
      command: 'git branch --show-current',
      workdir: requestedCwd,
      timeoutMs: 3000,
    })
      .then((result) => {
        if (!deps.owner.current() || state.sessions.ingress.read().cwd !== requestedCwd) return
        const branch = result.stdout.text.trim()
        if (branch !== '') {
          state.sessions.ingress.update(draft => { draft.gitBranch = branch })
          deps.noteBranch?.(branch)
          publishRuntime(state)
        }
      })
      .catch(() => {
        // Git branch detection is best-effort; on Windows the sandbox
        // backend may be unavailable (no confinement yet) or the cwd may
        // not be a git repo. Either way the statusline simply stays blank.
      })
  }
}
