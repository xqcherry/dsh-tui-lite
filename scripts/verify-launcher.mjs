/** Exercise the installed launcher without a global dsh, pnpm, or network. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temp = mkdtempSync(join(tmpdir(), 'tui-launcher-'))
const name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name
try {
  const pkg = join(temp, 'installed package')
  mkdirSync(pkg)
  for (const file of ['bin', 'lib', 'package.json', 'cordis.patch.yml']) cpSync(join(root, file), join(pkg, file), { recursive: true })
  const runtime = join(pkg, 'node_modules', '@deepseek-ai', 'dsh')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.2', type: 'module', bin: { dsh: './cli.js' } }))
  writeFileSync(join(runtime, 'cli.js'), `import { writeFileSync } from 'node:fs'
writeFileSync(process.env.LAUNCH_LOG, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), workspace: process.env.DSH_TUI_WORKSPACE_TARGET }))
process.exit(Number(process.env.CHILD_EXIT ?? 0))
`)
  const home = join(temp, 'home')
  const log = join(temp, 'launch.json')
  const env = { ...process.env, PATH: '', DSH_HOME: home, LAUNCH_LOG: log, DSH_TUI_WORKSPACE_TARGET: '' }
  const run = (args = [], extra = {}) => spawnSync(process.execPath, [join(pkg, 'bin/dsh-tui.js'), ...args], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 10000 })
  const args = ['--resume', 'session-123', 'a prompt with spaces', '$(literal)', '--thinking']
  const first = run(args)
  assert.equal(first.status, 0, first.stderr)
  const call = JSON.parse(readFileSync(log, 'utf8'))
  assert.deepEqual(call.args, ['--profile', 'dsh-tui', '--', ...args])
  assert.equal(call.cwd, process.cwd())
  const workspace = join(temp, 'project with spaces')
  mkdirSync(workspace)
  assert.equal(run([workspace, 'inspect this project']).status, 0)
  const targeted = JSON.parse(readFileSync(log, 'utf8'))
  assert.equal(targeted.workspace, workspace)
  assert.deepEqual(targeted.args, ['--profile', 'dsh-tui', '--', 'inspect this project'])
  assert.equal(run(['.']).status, 0)
  assert.equal(JSON.parse(readFileSync(log, 'utf8')).workspace, '.')
  assert.equal(run([join(temp, 'not-created-yet')]).status, 0)
  assert.equal(JSON.parse(readFileSync(log, 'utf8')).workspace, join(temp, 'not-created-yet'))
  assert.equal(run(['--', workspace]).status, 0)
  const literal = JSON.parse(readFileSync(log, 'utf8'))
  assert.equal(literal.workspace, undefined)
  assert.deepEqual(literal.args, ['--profile', 'dsh-tui', '--', '--', workspace])
  assert.equal(run(['--patch', workspace, '--resume', workspace]).status, 0)
  const optionValues = JSON.parse(readFileSync(log, 'utf8'))
  assert.equal(optionValues.workspace, undefined)
  assert.deepEqual(optionValues.args, ['--profile', 'dsh-tui', '--patch', workspace, '--', '--resume', workspace])
  assert.equal(run([workspace], { DSH_TUI_WORKSPACE_TARGET: '/explicit/workspace' }).status, 0)
  assert.equal(JSON.parse(readFileSync(log, 'utf8')).workspace, '/explicit/workspace')
  const profile = join(home, 'profiles', 'dsh-tui')
  const manifest = join(profile, 'package.json')
  const original = JSON.parse(readFileSync(manifest, 'utf8'))
  assert.deepEqual(original.dsh.profile.bundles, ['@deepseek-ai/dsh-base', name])
  assert.equal(realpathSync(join(profile, 'node_modules', name)), realpathSync(pkg))
  const patch = join(profile, 'cordis.patch.yml')
  const userPatch = '- id: dsh-tui\n  config:\n    effort: high\n'
  writeFileSync(patch, userPatch)
  original.description = 'keep user fields'
  original.dependencies = { 'user-plugin': '1.0.0' }
  writeFileSync(manifest, JSON.stringify(original))
  assert.equal(run().status, 0)
  assert.equal(readFileSync(patch, 'utf8'), userPatch)
  assert.deepEqual(JSON.parse(readFileSync(manifest, 'utf8')), original)
  assert.equal(run([], { CHILD_EXIT: '17' }).status, 17)
  const newer = join(temp, 'new installation')
  cpSync(pkg, newer, { recursive: true })
  const upgraded = spawnSync(process.execPath, [join(newer, 'bin/dsh-tui.js')], { env, encoding: 'utf8', timeout: 10000 })
  assert.equal(upgraded.status, 0, upgraded.stderr)
  assert.equal(realpathSync(join(profile, 'node_modules', name)), realpathSync(newer))
  assert.equal(readFileSync(patch, 'utf8'), userPatch)
  writeFileSync(manifest, '{broken')
  const broken = run()
  assert.notEqual(broken.status, 0)
  assert.match(broken.stderr, /profile|JSON/i)
  assert.equal(readFileSync(manifest, 'utf8'), '{broken')
  assert.equal(existsSync(join(home, 'profiles', 'dsh-tui-safe')), false)
  console.log('Installed launcher passed: local runtime, arguments, profile preservation, upgrade, exit status')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
