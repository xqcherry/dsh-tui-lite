/** Commands keep model admission and draft consumption independent of React. */
import assert from 'node:assert/strict'
import type { ProviderSetupHost } from '../src/shared/protocol/provider-settings.js'
import { createChatCommands, type ChatMenuItem } from '../src/modules/workbench/model/chat-commands.js'
import { createConfigurationCheck } from '../src/modules/settings/model/configuration-check.js'
import { createRuntimeModulesFixture } from './lib/runtime-modules-fixture.js'

const calls: unknown[] = []
let ready = false
const runtime = createRuntimeModulesFixture({ commands: {
  settings: {
    providerSetup: () => ({ oauth: {
      providers: async () => [{ provider: 'account', label: 'Account', signedIn: true }],
    } }) as ProviderSetupHost,
    switchModel: async (provider, model) => { calls.push(['model', provider, model]); return true },
  },
  sessions: {
    newSession: async () => { calls.push('new'); return true },
    resumeTo: async id => { calls.push(['resume', id]); return { ok: true } },
  },
  transcript: {
    compact: async () => { calls.push('compact') },
    pushLocal: (title, lines) => { calls.push([title, lines]); return undefined },
  },
  workbench: {
    notify: text => { calls.push(['notice', text]); return () => undefined },
    runExternalCommandOutcome: async (name, raw, images) => {
      calls.push([name, raw, images])
      return { kind: 'success', text: 'done', consumeDraft: false }
    },
  },
} })
let menuItems: readonly ChatMenuItem[] = []
let asked = 0
const commands = createChatCommands({
  ports: runtime,
  ask: async () => { asked++; return { answers: [] } },
  openMenu: (_title, items) => { menuItems = items },
  onExit: () => { calls.push('exit') },
  toggleHelp: () => { calls.push('help') },
  toggleThinking: () => { calls.push('thinking') },
  configured: () => ready,
  refreshConfiguration: async () => { calls.push('refresh') },
})
try {
  assert.equal(await commands.runCommand('model', ' provider/model/variant ', []), true)
  assert.deepEqual(calls.splice(0), [['model', 'provider', 'model/variant'], 'refresh'])
  await commands.runCommand('compact', '', [])
  assert.deepEqual(calls.splice(0), [['notice', 'Configure a model first: /provider or /auth']])
  ready = true
  await commands.runCommand('compact', '', [])
  assert.deepEqual(calls.splice(0), ['compact'])
  assert.equal(await commands.runCommand('plugin', ' raw argument ', [{ token: '[Image #1]', stageId: 'opaque' }]), false)
  assert.deepEqual(calls.splice(0), [
    ['plugin', ' raw argument ', [{ token: '[Image #1]', stageId: 'opaque' }]], ['notice', 'done'],
  ])
  await commands.runCommand('resume', 'other', [])
  await commands.runCommand('help', '', [])
  await commands.runCommand('thinking', '', [])
  assert.deepEqual(calls.splice(0), [['resume', 'other'], 'help', 'thinking'])
  await commands.runCommand('auth', 'login', [])
  assert.equal(menuItems.length, 1)
  await menuItems[0]!.run()
  assert.equal(asked, 1, 'signed-in login choice reaches the question queue once')
  assert.equal(calls.some(value => Array.isArray(value) && String(value[1]).includes('call stack')), false)
} finally { runtime.dispose() }

// A slow readiness result must not approve a replacement route, generation,
// newer check, or an unmounted UI.
let identity = { generation: 1, provider: 'one', model: 'first' }
const pending: ((value: boolean) => void)[] = []
const states: boolean[] = []
const check = createConfigurationCheck({
  read: () => identity,
  probe: () => new Promise<boolean>(resolve => pending.push(resolve)),
  publish: value => { states.push(value) },
})
const first = check.refresh()
identity = { ...identity, model: 'second' }
pending.shift()!(true)
await first
assert.deepEqual(states.splice(0), [false])
const second = check.refresh()
const third = check.refresh()
pending.shift()!(true)
await second
assert.deepEqual(states.splice(0), [false, false])
pending.shift()!(true)
await third
assert.deepEqual(states.splice(0), [true])
const fourth = check.refresh()
check.dispose()
pending.shift()!(true)
await fourth
assert.deepEqual(states.splice(0), [false])
console.log('Workbench commands passed: routing, admission, raw arguments, images, draft consumption and stale configuration')
