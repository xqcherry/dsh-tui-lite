/** npm command: run this installation's dsh with this installation's TUI. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROFILE = 'dsh-tui-lite'
const PACKAGE = 'dsh-tui-lite'

function manifest(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid profile manifest: ${path}`)
  return value as Record<string, unknown>
}

function record(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid dsh profile configuration')
  return value as Record<string, unknown>
}

/** Keep host options separate from the prompt and consume workspace targets. */
function commandLine(args: readonly string[]): { args: string[]; workspace: string | undefined } {
  const host: string[] = []
  const app: string[] = []
  const hostValues = new Set(['--profile', '--from-default-profile', '--patch'])
  const hostSwitches = new Set(['--dump-config', '--dump-default-config', '--dump-config-schema', '-V', '--version'])
  let workspace = process.env.DSH_TUI_WORKSPACE_TARGET || undefined
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!
    if (arg === '--') {
      app.push(...args.slice(i))
      break
    }
    const flag = arg.split('=', 1)[0]!
    if (app.length === 0 && (hostValues.has(flag) || hostSwitches.has(flag))) {
      host.push(arg)
      if (hostValues.has(flag) && arg === flag && args[i + 1] !== undefined) host.push(args[++i]!)
      continue
    }
    if (arg === '--resume' || arg === '--host' || arg === '--port') {
      app.push(arg)
      if (args[i + 1] !== undefined && !args[i + 1]!.startsWith('-')) app.push(args[++i]!)
      continue
    }
    if (arg === '--trusted-host') {
      app.push(arg)
      while (args[i + 1] !== undefined && !args[i + 1]!.startsWith('-')) app.push(args[++i]!)
      continue
    }
    if (workspace === undefined && !arg.startsWith('-') && (isAbsolute(arg) || existsSync(resolve(arg)) || /^[a-z][a-z0-9+.-]*:\/\//iu.test(arg))) {
      workspace = arg
      continue
    }
    app.push(arg)
  }
  return { args: [...host, ...(app.length > 0 ? ['--', ...app] : [])], workspace }
}

/** Preserve user fields and patch files; the only managed link is our package. */
function prepareProfile(home: string, packageRoot: string): void {
  const dir = join(home, 'profiles', PROFILE)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'package.json')
  const value = existsSync(path) ? manifest(path) : { name: 'dsh-profile-dsh-tui-lite', private: true }
  const dsh = record(value.dsh)
  const profile = record(dsh.profile)
  const existing = profile.bundles ?? []
  if (!Array.isArray(existing) || !existing.every(item => typeof item === 'string')) throw new Error(`Invalid profile bundles: ${path}`)
  const bundles = [...existing] as string[]
  if (!bundles.includes('@deepseek-ai/dsh-base')) bundles.unshift('@deepseek-ai/dsh-base')
  if (!bundles.includes(PACKAGE)) bundles.push(PACKAGE)

  const link = join(dir, 'node_modules', PACKAGE)
  mkdirSync(dirname(link), { recursive: true })
  let previous: ReturnType<typeof lstatSync> | undefined
  try { previous = lstatSync(link) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let current = false
  try { current = realpathSync(link) === realpathSync(packageRoot) } catch { /* dangling link is replaced */ }
  if (!current) {
    // A legacy real installation is retained as a backup, never deleted.
    if (previous !== undefined && !previous.isSymbolicLink()) {
      if (manifest(join(link, 'package.json')).name !== PACKAGE) throw new Error(`Refusing to replace unrelated profile directory: ${link}`)
      const backup = `${link}.previous-${randomUUID()}`
      renameSync(link, backup)
      process.stderr.write(`dsl: retained previous profile package at ${backup}\n`)
    }
    const temporary = `${link}.next-${randomUUID()}`
    symlinkSync(packageRoot, temporary, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      // Windows does not replace an existing junction during rename.
      if (process.platform === 'win32' && previous?.isSymbolicLink()) unlinkSync(link)
      renameSync(temporary, link)
    } finally {
      try { unlinkSync(temporary) } catch { /* rename consumed it */ }
    }
  }
  if (JSON.stringify(existing) !== JSON.stringify(bundles)) {
    if (existsSync(path)) writeFileSync(`${path}.before-tui-${randomUUID()}`, readFileSync(path))
    writeFileSync(path, JSON.stringify({ ...value, dsh: { ...dsh, profile: { ...profile, bundles } } }, null, 2) + '\n')
  }
  try { writeFileSync(join(dir, 'cordis.patch.yml'), '[]\n', { flag: 'wx' }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

export async function launch(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const require = createRequire(import.meta.url)
  const runtimeManifest = require.resolve('@deepseek-ai/dsh/package.json')
  const runtime = manifest(runtimeManifest)
  const bin = record(runtime.bin).dsh
  if (typeof bin !== 'string') throw new Error('The bundled dsh runtime has no CLI entry')
  const packageRoot = fileURLToPath(new URL('../../../', import.meta.url))
  const home = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
  const command = commandLine(args)
  prepareProfile(home, packageRoot)
  const child = spawn(process.execPath, [resolve(dirname(runtimeManifest), bin), '--profile', PROFILE, ...command.args], {
    stdio: 'inherit',
    env: { ...process.env, DSH_HOME: home, DSH_TUI_WORKSPACE_TARGET: command.workspace, DSH_TUI_LAUNCHER_VERSION: String(manifest(join(packageRoot, 'package.json')).version) },
  })
  // Raw-terminal Ctrl+C belongs to the child; OS signals still reach it.
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
  const handlers = signals.map(signal => {
    const handler = (): void => { child.kill(signal) }
    process.on(signal, handler)
    return [signal, handler] as const
  })
  try {
    return await new Promise<number>((done, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => done(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)))
    })
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler)
  }
}
