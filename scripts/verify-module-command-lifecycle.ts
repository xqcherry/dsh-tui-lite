import assert from 'node:assert/strict'
import { createComposerModule } from '../src/modules/composer/model/module.js'
import { createActivityModule } from '../src/modules/activity/model/module.js'
import { createPublication } from '../src/shared/state/module-store.js'
import type { ComposerCommandHost } from '../src/modules/composer/contracts.js'
import type { ActivityCommandHost } from '../src/modules/activity/contracts.js'
import type { ModuleLaunch } from '../src/shared/protocol/module-launch.js'

const launch: ModuleLaunch = {
  options: { model: 'fixture', provider: 'fixture', cwd: '/fixture' },
  input: { agentId: 'agent', sessionId: 'session', mode: { id: 'normal', label: 'Normal' }, cwdDescription: '/fixture' },
}
const publication = createPublication()
const composer = createComposerModule(launch, publication)
const activity = createActivityModule(launch, publication)
let calls = 0
const submit = composer.commands.submit
const kill = activity.commands.jobControl.kill
assert(Object.isFrozen(composer.commands))
assert(Object.isFrozen(activity.commands.jobControl))
assert.throws(() => submit('before'), /not connected|not active/)
assert.throws(() => composer.startCommands(), /not connected/)
composer.connectHost({ submit() {
  calls++
  composer.ingress.setCancelPending(true)
  composer.ingress.setSelection(undefined)
} } as ComposerCommandHost)
const jobControl: ActivityCommandHost['jobControl'] = {
  kill: () => { calls++; return true },
  watchOutput() { assert.equal(this, jobControl, 'job controls retain their host receiver'); return () => undefined },
}
const subagentControl: ActivityCommandHost['subagentControl'] = {
  interrupt: () => false,
  async history() { assert.equal(this, subagentControl, 'history retains its host receiver'); calls++; return null },
  message: {
    via: 'direct-continuable', steer: true,
    listTargets: async () => { calls++; return [] },
    submit: async () => ({ ok: false, reason: 'unavailable' }),
    messages: () => [],
  },
}
activity.connectHost({ jobControl, subagentControl } as ActivityCommandHost)
assert.throws(() => submit('connected'), /not active/)
assert.throws(() => kill('job'), /not active/)
assert.throws(() => composer.connectHost({} as ComposerCommandHost), /already connected/)
composer.startCommands()
activity.startCommands()
let publishes = 0
const unsubscribe = composer.store.subscribe(() => { publishes++ })
submit('active')
assert.equal(calls, 1)
assert.equal(publishes, 1, 'the module batches command writes')
assert.equal(kill('job'), true)
assert.equal(calls, 2)
const watchOutput = activity.commands.jobControl.watchOutput!
assert.equal(typeof watchOutput('job'), 'function')
const history = activity.commands.subagentControl.history!
const message = activity.commands.subagentControl.message!
assert.equal(await history('child'), null)
assert.deepEqual(await message.listTargets(), [])
assert.equal(message.via, 'direct-continuable')
assert.equal(message.steer, true)
assert.equal(calls, 4)
const withoutChildTransport = createActivityModule(launch, publication)
withoutChildTransport.connectHost({ jobControl: { kill: () => false }, subagentControl: { interrupt: () => false } } as ActivityCommandHost)
withoutChildTransport.startCommands()
assert.equal(withoutChildTransport.commands.jobControl.watchOutput, undefined)
assert.equal(withoutChildTransport.commands.subagentControl.history, undefined)
assert.equal(withoutChildTransport.commands.subagentControl.message, undefined)
withoutChildTransport.dispose()
composer.dispose()
activity.dispose()
assert.throws(() => submit('disposed'), /lifetime has ended/)
assert.throws(() => kill('job'), /lifetime has ended/)
assert.throws(() => watchOutput('job'), /lifetime has ended/)
assert.throws(() => history('child'), /lifetime has ended/)
assert.throws(() => message.listTargets(), /lifetime has ended/)
assert.equal(calls, 4, 'captured commands cannot reach a disposed host')
unsubscribe()
publication.dispose()
console.log('Module command lifecycle passed: connection, activation, batching, nested revocation')
