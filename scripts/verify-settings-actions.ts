/** Route metadata, effort preference and caches are settings-owned policies. */
import assert from 'node:assert/strict'
import { createSettingsModelActions, type SettingsModelInfo } from '../src/modules/settings/model/model-actions.js'
import { createRuntimeModulesFixture } from './lib/runtime-modules-fixture.js'

const runtime = createRuntimeModulesFixture()
let generation = 0
let alive = true
let pin: { provider: string; model: string; effort?: string } | undefined
const notices: string[] = []
const pending: ((info: SettingsModelInfo) => void)[] = []
let catalogReads = 0
const model = createSettingsModelActions(runtime.settings.ingress, {
  current: () => alive,
  capture: () => generation,
  bindingCurrent: capture => capture === generation,
  models: {
    resolveModelInfo: () => new Promise<SettingsModelInfo>(resolve => pending.push(resolve)),
    listProviders: () => [{ id: 'fixture', name: 'Fixture' }],
    listModels: async () => { catalogReads++; return [{ provider: 'fixture', id: 'fixture-model', name: 'Fixture' }] },
  },
  pinnedEffort: () => pin?.effort,
  pin: value => { pin = value },
  notify: text => { notices.push(text); return () => undefined },
  publish: () => undefined,
  checkContextWarning: () => undefined,
}, 'high')
try {
  const first = model.setEffort('high')
  generation++
  pending.shift()!({ context: { contextWindow: 100 }, reasoning: { efforts: [{ id: 'high', name: 'High' }] } })
  assert.equal(await first, false)
  assert.equal(pin, undefined)
  assert.equal(runtime.settings.store.getSnapshot().contextWindow, 100, 'same route metadata survives binding change')
  // Opening the post-model picker must not cancel the bind-time preference.
  runtime.settings.ingress.setReasoningEffort(undefined)
  const restoring = model.applyPreferredEffort()
  const listing = model.listEfforts()
  const reasoning = { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' }
  pending.shift()!({ reasoning })
  await restoring
  assert.deepEqual(pin, { provider: 'fixture', model: 'fixture-model', effort: 'high' }, 'listing must preserve the restored effort pin even if the picker is cancelled')
  await new Promise(resolve => setImmediate(resolve))
  pending.shift()!({ reasoning })
  assert.equal((await listing).efforts.length, 2)
  assert.equal(runtime.settings.store.getSnapshot().reasoningEffort, 'high', 'the picker must observe the restored effort')
  const fallback = model.applyPreferredEffort()
  pending.shift()!({ reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } })
  await fallback
  assert.deepEqual(pin, { provider: 'fixture', model: 'fixture-model', effort: 'low' })
  const noticeCount = notices.length
  const again = model.applyPreferredEffort()
  pending.shift()!({ reasoning: { efforts: [{ id: 'low', name: 'Low' }] } })
  await again
  assert.equal(notices.length, noticeCount, 'fallback toast is deduplicated but pin reapplied')
  model.warmModelNodes()
  await new Promise(resolve => setImmediate(resolve))
  model.warmModelNodes()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(catalogReads, 1)
  assert.equal(model.modelNodes().length, 1)
  model.dropModelNodeCache()
  model.warmModelNodes()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(catalogReads, 2)
  model.setDefaultEffort('max')
  pending.shift()!({ reasoning: { efforts: [{ id: 'custom', name: 'Custom' }], defaultEffort: 'custom' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.settings.store.getSnapshot().reasoningEffort, 'custom')
  assert.deepEqual(pin, { provider: 'fixture', model: 'fixture-model' }, 'unsupported preference clears only the effort pin')
  const late = model.setEffort('low')
  alive = false
  pending.shift()!({ context: { contextWindow: 200 }, reasoning: { efforts: [{ id: 'low', name: 'Low' }] } })
  assert.equal(await late, false)
  assert.equal(runtime.settings.store.getSnapshot().contextWindow, 100)
} finally { runtime.dispose() }

const defaultRuntime = createRuntimeModulesFixture()
let defaultInfo: ((info: SettingsModelInfo) => void) | undefined
let defaultPin: { provider: string; model: string; effort?: string } | undefined
const defaultModel = createSettingsModelActions(defaultRuntime.settings.ingress, {
  current: () => true,
  capture: () => 0,
  bindingCurrent: capture => capture === 0,
  models: {
    resolveModelInfo: () => new Promise<SettingsModelInfo>(resolve => { defaultInfo = resolve }),
    listProviders: () => [],
    listModels: async () => [],
  },
  pinnedEffort: () => defaultPin?.effort,
  pin: value => { defaultPin = value },
  notify: () => () => undefined,
  publish: () => undefined,
  checkContextWarning: () => undefined,
})
try {
  const applyingDefault = defaultModel.applyPreferredEffort()
  defaultInfo!({ reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }], defaultEffort: 'medium' } })
  await applyingDefault
  assert.equal(defaultRuntime.settings.store.getSnapshot().reasoningEffort, 'medium', 'the model default is shown when no user preference exists')
  assert.equal(defaultPin, undefined, 'the displayed model default is not pinned as a user choice')
} finally { defaultRuntime.dispose() }
console.log('Settings actions passed: binding fences, route metadata, fallback, cache and disposal')
