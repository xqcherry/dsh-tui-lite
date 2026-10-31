import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
if (process.platform === 'win32') {
  console.log('Runtime PTY smoke requires POSIX; Windows input protocols are covered separately')
} else {
  const result = spawnSync('python3', ['scripts/verify-runtime-boot.py', process.execPath], { encoding: 'utf8', timeout: 45000 })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  process.stdout.write(result.stdout)
}
