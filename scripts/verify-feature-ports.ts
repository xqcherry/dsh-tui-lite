/** Actual public module bindings: immutable snapshots and narrow command authority. */
import assert from 'node:assert/strict'
import { createWorkbenchBindings } from '../src/dsh-adapter/workbench-bindings.js'
import { resolveBindingGeneration } from '../src/modules/composer/model/promptDraftCache.js'
import { createRuntimeModulesFixture } from './lib/runtime-modules-fixture.js'
import { createChannelOwner, registerChannelOwner } from '../src/shared/lifecycle/owner.js'

let cancellations = 0
let modeCycles = 0
let credentialWrites = 0
const runtime = createRuntimeModulesFixture({
  commands: {
    sessions: { cycleMode: async () => { modeCycles++ }, deleteSession: async () => true },
    composer: { stagedImageGeneration: () => 99, cancel: () => { cancellations++ } },
    settings: { providerSetup: () => ({ writeCredential: () => { credentialWrites++ } }) as never },
  },
})
runtime.sessions.ingress.patch({ agentBindingGeneration: 7 })
const owner = createChannelOwner()
registerChannelOwner(runtime, owner)
const bindings = createWorkbenchBindings(runtime)
try {
  assert.deepEqual(Object.keys(bindings).sort(), ['activity', 'composer', 'sessions', 'settings', 'transcript', 'workbench'])
  for (const binding of Object.values(bindings)) {
    assert.deepEqual(Object.keys(binding).sort(), ['commands', 'store'])
    assert.deepEqual(Object.keys(binding.store).sort(), ['getSnapshot', 'subscribe'])
    assert(Object.isFrozen(binding))
    assert(Object.isFrozen(binding.commands))
    assert.equal('ingress' in binding, false)
    assert.equal('dispose' in binding, false)
  }
  assert.equal('deleteSession' in bindings.composer.commands, false)
  assert.equal('cycleMode' in bindings.composer.commands, false)
  assert.equal('providerSetup' in bindings.transcript.commands, false)
  assert.equal('agentBindingGeneration' in bindings.composer.store.getSnapshot(), false)
  assert.equal(resolveBindingGeneration({
    ...bindings.sessions.store.getSnapshot(),
    stagedImageGeneration: bindings.composer.commands.stagedImageGeneration,
  }), 7, 'the agent binding fence takes precedence over staged image generation')
  const before = bindings.settings.store.getSnapshot()
  assert.equal(before, bindings.settings.store.getSnapshot(), 'unchanged snapshots keep identity')
  let settingsUpdates = 0
  let composerUpdates = 0
  const stopSettings = bindings.settings.store.subscribe(() => {
    settingsUpdates++
    assert.equal(bindings.sessions.store.getSnapshot().agentBindingGeneration, 8, 'all owners publish before listeners run')
  })
  const stopComposer = bindings.composer.store.subscribe(() => { composerUpdates++ })
  runtime.publication.batch(() => {
    runtime.sessions.ingress.patch({ agentBindingGeneration: 8 })
    runtime.settings.ingress.patch({ model: 'model-b' })
  })
  assert.equal(bindings.settings.store.getSnapshot().model, 'model-b')
  assert.equal(before.model, 'fixture-model', 'older snapshots keep their original values')
  assert.equal(settingsUpdates, 1)
  assert.equal(composerUpdates, 0, 'settings/session changes do not publish composer state')
  assert.equal(Reflect.set(bindings.settings.store.getSnapshot(), 'model', 'invalid'), false)
  assert.equal(Reflect.set(bindings.composer.commands, 'deleteSession', () => true), false)
  await bindings.sessions.commands.cycleMode()
  bindings.composer.commands.cancel()
  assert.equal(modeCycles, 1)
  assert.equal(cancellations, 1)
  stopSettings()
  stopComposer()
  const provider = bindings.settings.commands.providerSetup()!
  provider.writeCredential('test', 'test')
  assert.equal(credentialWrites, 1)
  owner.dispose()
  assert.throws(() => bindings.composer.commands.cancel(), /lifetime has ended/)
  assert.throws(() => provider.writeCredential('test', 'test'), /lifetime has ended/, 'retained nested capabilities revoke with their mount')
  assert.equal(credentialWrites, 1)
} finally {
  owner.dispose()
  runtime.dispose()
}
console.log('Feature bindings passed: generation fence, owned commands, stable immutable snapshots and independent subscriptions')
