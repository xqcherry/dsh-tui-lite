/** Supported regression suite. Each child receives a disposable home. */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const checks = [
  'verify-workbench-commands.ts',
  'verify-new-session-planner.ts',
  'verify-session-transitions.ts',
  'verify-settings-actions.ts',
  'verify-composer-delivery.ts',
  'verify-boundaries.mjs',
  'verify-feature-modules.mjs',
  'verify-module-store.ts',
  'verify-activity-owners.ts',
  'verify-feature-ports.ts',
  'verify-upstream-contract.ts',
  'verify-runtime-boot.mjs',
  'verify-minimal-config.ts',
  'verify-model-configuration.ts',
  'verify-host-preset.ts',
  'verify-prompt-submit-guard.mjs',
  'verify-minimal-chat-input.mjs',
  'verify-batched-prompt-input.mjs',
  'verify-prompt-undo.mjs',
  'verify-prompt-history-draft.mjs',
  'verify-prompt-history-persist.mjs',
  'verify-prompt-history-overlay.mjs',
  'verify-prompt-history-queue-retract.mjs',
  'verify-binding-transaction.ts',
  'verify-session-reset.ts',
  'verify-projection-golden.ts',
  'verify-dsh-translate.ts',
  'verify-provider-wizard.mjs',
  'verify-oauth.mjs',
  'verify-launcher.mjs',
  'verify-markdown-render.tsx',
  'verify-streaming-markdown-blocks.tsx',
  'verify-table-layout.tsx',
  'verify-message-measure-depth.tsx',
  'verify-question-backtrack.tsx',
  'verify-question-paste.tsx',
  'verify-approval-panel-options.tsx',
  'verify-approval-source-badge.tsx',
  'verify-teardown-exit.tsx',
  'verify-win32-protocol.ts',
  'verify-image-downsample.tsx',
  'verify-clipboard-image.ts',
  'verify-model-route.mjs',
]
const sourceChecks = new Set(['verify-prompt-submit-guard.mjs', 'verify-minimal-chat-input.mjs'])
let index = 0
let failures = 0
async function worker() {
  while (index < checks.length) {
    const script = checks[index++]
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-check-'))
    const result = await new Promise(resolve => {
      let output = ''
      const loader = /\.tsx?$/.test(script) || sourceChecks.has(script) ? ['--import', 'tsx/esm'] : []
      const child = spawn(process.execPath, [...loader, `scripts/${script}`], {
        env: { ...process.env, HOME: home, USERPROFILE: home, NODE_ENV: 'production' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const timer = setTimeout(() => child.kill('SIGKILL'), 90_000)
      child.stdout.on('data', data => { output += data })
      child.stderr.on('data', data => { output += data })
      child.on('error', error => { output += error.message })
      child.on('close', (code, signal) => {
        clearTimeout(timer)
        resolve({ passed: code === 0, output, signal })
      })
    })
    rmSync(home, { recursive: true, force: true })
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${script}`)
    if (!result.passed) { failures++; console.error(result.output || result.signal) }
  }
}
// Render/image checks can saturate the desktop when several run together.
await worker()
console.log(`${checks.length - failures}/${checks.length} checks passed`)
process.exitCode = failures ? 1 : 0
