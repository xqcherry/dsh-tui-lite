import type { Context } from '@deepseek-ai/cordis'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'

interface PresetRegistry {
  readonly defaultId?: string
  list(): Promise<readonly { id: string }[]>
  register(definition: PresetDefinition): Promise<() => Promise<void>>
}

interface PresetLoader {
  entries(): Iterable<{ disabled: boolean; options: { name?: string; config?: unknown } }>
}

const registrations = new WeakMap<object, Map<string, Promise<boolean>>>()

function readDefinition(path: string, id: string): PresetDefinition {
  const patches: unknown = parse(readFileSync(path, 'utf8'), {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => ({ __jsExpr: value }) }],
  })
  if (Array.isArray(patches) && patches.length === 1) {
    const row = patches[0]?.insert?.[0]
    if (row?.name === '@deepseek-ai/dsh-agent-preset' && row.config?.id === id && Array.isArray(row.config.plugins)) {
      return row.config as PresetDefinition
    }
  }
  throw new Error(`dsh-tui: invalid host preset declaration: ${path}`)
}

/** Supply the selected official preset after the host Loader has settled.
 * Existing profile declarations and legacy directory discovery remain authoritative. */
export async function ensureHostPreset(ctx: Context, requested?: string): Promise<boolean> {
  const service: unknown = ctx.get('agentPresets')
  if (service === null || typeof service !== 'object' || !('register' in service) || typeof service.register !== 'function') return false
  const registry = service as PresetRegistry
  const id = requested ?? registry.defaultId ?? 'standard'
  const active = registrations.get(service)?.get(id)
  if (active !== undefined) return active
  const loader = ctx.get('loader') as PresetLoader | undefined
  for (const entry of loader?.entries() ?? []) {
    if (entry.disabled || entry.options.name !== '@deepseek-ai/dsh-agent-preset') continue
    const config: unknown = entry.options.config
    if (config !== null && typeof config === 'object' && 'id' in config && config.id === id) return true
  }
  if ((await registry.list()).some(preset => preset.id === id)) return true
  // IDs are single host asset names, never package paths supplied by a caller.
  if (!/^[a-z][a-z0-9-]*$/u.test(id)) return false
  let pending = registrations.get(service)
  if (pending === undefined) {
    pending = new Map()
    registrations.set(service, pending)
  }
  const existing = pending.get(id)
  if (existing !== undefined) return existing
  const task = (async (): Promise<boolean> => {
    const require = createRequire(ctx.baseUrl ?? import.meta.url)
    let path: string
    try {
      path = require.resolve(`@deepseek-ai/dsh-web-app/presets/${id}.patch.yml`)
    } catch (error) {
      if (id !== 'standard' && (error as { code?: unknown }).code === 'MODULE_NOT_FOUND') return false
      throw error
    }
    const owner = ctx.extend({ baseUrl: pathToFileURL(path).href })
    const dispose = await (owner.get('agentPresets') as PresetRegistry).register(readDefinition(path, id))
    ctx.effect(() => dispose)
    return true
  })()
  pending.set(id, task)
  try {
    return await task
  } finally {
    if (pending.get(id) === task) pending.delete(id)
  }
}
