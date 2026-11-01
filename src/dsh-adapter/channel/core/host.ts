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
  cwd(): string
  setGitBranch(branch: string | undefined): void
  publish(): void
  /** Record the resolved branch against the bound session (the session
   *  browser's branch column); absent = nothing records it. */
  noteBranch?(branch: string): void
}): () => void {
  return () => {
    deps.setGitBranch(undefined)
    const shell = ctx.get('shell') as ForegroundShell | undefined
    if (!shell) return
    // Capture the requested cwd: a /resume landing while this query is in
    // flight refreshes the branch for the new cwd, so a late reply from the
    // old workspace must be dropped (stale statusline, issue #96).
    const requestedCwd = deps.cwd()
    void runForegroundShell(shell, {
      command: 'git branch --show-current',
      workdir: requestedCwd,
      timeoutMs: 3000,
    })
      .then((result) => {
        if (!deps.owner.current() || deps.cwd() !== requestedCwd) return
        const branch = result.stdout.text.trim()
        if (branch !== '') {
          deps.setGitBranch(branch)
          deps.noteBranch?.(branch)
          deps.publish()
        }
      })
      .catch(() => {
        // Git branch detection is best-effort; on Windows the sandbox
        // backend may be unavailable (no confinement yet) or the cwd may
        // not be a git repo. Either way the statusline simply stays blank.
      })
  }
}
