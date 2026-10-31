/** Real npm artifact install. Deliberately separate from the offline regression suite. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temp = mkdtempSync(join(tmpdir(), 'tui-npm-'))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 240000, ...options })
  assert.equal(result.status, 0, result.error?.message || `${command}:\n${result.stderr}\n${result.stdout}`)
  return result.stdout
}
try {
  const pack = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp]))[0]
  const prefix = join(temp, 'installation')
  console.log('Installing the packed client and its production runtime with npm…')
  run('npm', ['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', join(temp, pack.filename)])
  const installed = process.platform === 'win32' ? join(prefix, 'node_modules', pkg.name) : join(prefix, 'lib', 'node_modules', pkg.name)
  const nodeOnly = join(temp, 'path')
  mkdirSync(nodeOnly)
  symlinkSync(process.execPath, join(nodeOnly, process.platform === 'win32' ? 'node.exe' : 'node'))
  const home = join(temp, 'home')
  const env = { ...process.env, DSH_HOME: home, HOME: home, USERPROFILE: home, PATH: nodeOnly }
  const command = join(installed, 'bin', 'dsh-tui.js')
  const dump = run(process.execPath, [command, '--dump-config'], { env })
  assert.match(dump, /dsh-tui-auth/)
  assert.match(dump, /dsh-tui-subagent-model-selection-settings/)
  assert.equal(realpathSync(join(home, 'profiles', 'dsh-tui', 'node_modules', pkg.name)), realpathSync(installed))
  run(process.execPath, [command, '--dump-config'], { env })
  if (process.platform !== 'win32') {
    // This boots the installed artifact itself in a real 68-column terminal.
    console.log(run('python3', ['scripts/verify-runtime-boot.py', process.execPath, installed]).trim())
  }
  console.log(`Packed npm installation passed: ${pkg.name}@${pkg.version}, local kernel, no global dsh/pnpm, repeat launch`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
