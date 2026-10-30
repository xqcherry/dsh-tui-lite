/** Source regression: run node --import tsx/esm scripts/verify-host-preset.ts. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { parse } from 'yaml'
import { ensureHostPreset } from '../src/dsh-adapter/host-preset.js'

function harness(options: { declared?: boolean; existing?: boolean; defaultId?: string; legacy?: boolean } = {}) {
  const definitions: PresetDefinition[] = []
  const rows = new Set(options.existing ? ['standard'] : [])
  const cleanup: (() => Promise<void>)[] = []
  const bases: string[] = []
  const registry = {
    defaultId: options.defaultId ?? 'standard',
    async list() { return [...rows].map(id => ({ id })) },
    async register(definition: PresetDefinition) {
      definitions.push(definition)
      rows.add(definition.id)
      return async () => { rows.delete(definition.id) }
    },
  }
  const loader = {
    entries: () => options.declared ? [{ disabled: false, options: { name: '@deepseek-ai/dsh-agent-preset', config: { id: 'standard' } } }] : [],
  }
  const ctx = {
    baseUrl: new URL('../package.json', import.meta.url).href,
    get(name: string) { return name === 'agentPresets' ? options.legacy ? { defaultId: 'standard' } : registry : name === 'loader' ? loader : undefined },
    extend({ baseUrl }: { baseUrl: string }) {
      bases.push(baseUrl)
      return { get: () => registry }
    },
    effect(factory: () => () => Promise<void>) { cleanup.push(factory()) },
  } as unknown as Context
  return { ctx, definitions, rows, cleanup, bases }
}

const fresh = harness()
assert.deepEqual(await Promise.all([ensureHostPreset(fresh.ctx), ensureHostPreset(fresh.ctx)]), [true, true])
assert.deepEqual(fresh.definitions.map(definition => definition.id), ['standard'], 'bootstrap must install one preset, even with concurrent callers')
const require = createRequire(import.meta.url)
const path = require.resolve('@deepseek-ai/dsh-web-app/presets/standard.patch.yml')
const official = parse(readFileSync(path, 'utf8'), {
  customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => ({ __jsExpr: value }) }],
})[0].insert[0].config
assert.deepEqual(fresh.definitions[0], official, 'tool definitions and platform expressions must come from the official shipped preset')
assert.deepEqual(fresh.bases, [pathToFileURL(path).href], 'relative includes must resolve from the official preset asset')
assert.ok(fresh.definitions[0]!.plugins.some(plugin => plugin.name === '@deepseek-ai/dsh-tool-fs'), 'standard must retain real host tools')
await ensureHostPreset(fresh.ctx)
assert.equal(fresh.definitions.length, 1, 'existing registry entries must retain ownership')
for (const dispose of fresh.cleanup) await dispose()
assert.equal(fresh.rows.size, 0, 'registrations must leave with the TUI owner')

for (const fixture of [harness({ declared: true }), harness({ existing: true })]) {
  assert.equal(await ensureHostPreset(fixture.ctx), true)
  assert.equal(fixture.definitions.length, 0, 'profile declarations and preexisting registrations must not be replaced')
}
const legacy = harness({ legacy: true })
assert.equal(await ensureHostPreset(legacy.ctx), false)
assert.equal(legacy.definitions.length, 0, 'legacy directory discovery must remain untouched')
const selected = harness({ defaultId: 'ptc' })
assert.equal(await ensureHostPreset(selected.ctx), true)
assert.deepEqual(selected.definitions.map(definition => definition.id), ['ptc'], 'an official configured default must load only its own definition')
const missing = harness()
assert.equal(await ensureHostPreset(missing.ctx, 'not-a-host-preset'), false)
assert.equal(await ensureHostPreset(missing.ctx, '../standard'), false)
assert.equal(missing.definitions.length, 0)
console.log('host preset bootstrap regression passed')

const { composePreset } = await import('../src/dsh-adapter/presets.js')
const unavailable = {
  get: () => ({
    defaultId: 'broken',
    resolve: async () => { throw new Error('preset activation failed') },
  }),
  logger: { warn() {} },
} as unknown as Context
await assert.rejects(() => composePreset(unavailable), /preset activation failed/, 'a broken roster must not create a session without its coding tools')
