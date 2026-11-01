import assert from 'node:assert/strict'
import { createNewSessionPlanner } from '../src/modules/sessions/model/new-session-planner.js'
import type { NewSessionPlannerHost } from '../src/modules/sessions/model/new-session-planner.js'
import { createSessionHandoff } from '../src/modules/sessions/model/session-switch.js'

function fixture() {
  const calls: string[] = []
  let current = true
  let fail = ''
  const record = (name: string): void => { calls.push(name); if (fail === name) throw new Error(name) }
  const host: NewSessionPlannerHost<symbol, symbol, symbol> = {
    options: { provider: 'default', model: 'default' },
    available: () => true,
    begin: () => Symbol('attempt'),
    settleCompaction: async () => { record('compaction') },
    allocate: () => { record('id'); return Symbol('id') },
    readPresetPref: () => { record('read-preset'); return 'saved-preset' },
    composePreset: async () => { record('preset'); return { resource: Symbol('preset'), agentPreset: 'preset' } },
    readModelPref: () => { record('read-model'); return { provider: 'saved', model: 'saved' } },
    validateRoute: async route => { record('validate'); return { route } },
    migratePresetPref: () => { record('migrate'); return true },
    reserve: async () => { record('reserve'); return { settle: () => record('settle'), abandon: () => record('release') } },
    open: async () => { record('open'); return Symbol('session') },
    attach: async () => { record('attach') },
    reset: () => record('reset'),
    bindAgent: () => record('bind'),
    refreshCommands: () => record('commands'),
    refreshLoadedContext: async () => { record('context') },
    refreshSkillCommands: async () => { record('skills') },
    remember: () => { record('remember'); return 'new' },
    notify: () => { record('notify'); return () => {} },
  }
  const handoff = createSessionHandoff({
    current: () => current,
    capture: () => Symbol('capture'),
    bindingCurrent: () => current,
    prepare: async (_capture, create) => create(),
    abandon: async () => record('abandon'),
    adopt<Result>(_candidate: symbol, _capture: symbol, tail: (dispose: (next: 'dispose' | 'park') => void) => Result): Result {
      record('adopt')
      return tail(() => record('dispose'))
    },
    read: () => ({ cwd: '/old', working: false, pending: [] }),
    commitWorkspace: () => record('cwd'),
    notify: host.notify,
    resetIdeSelection: () => record('ide'),
    clearStagedImages: () => record('clear-input'),
    opener: () => createNewSessionPlanner(host),
    activity: () => ({ inputs: 0, unsettled: false, turnStarts: 0 }),
    unavailable: () => record('unavailable'),
  })
  return { host, calls, handoff, cancel: () => { current = false }, fail: (name: string) => { fail = name } }
}
{
  const f = fixture()
  assert.equal(await f.handoff.newSession(), true)
  assert.deepEqual(f.calls, ['compaction', 'id', 'read-preset', 'preset', 'read-model', 'validate', 'migrate', 'reserve', 'open', 'attach', 'adopt', 'cwd', 'ide', 'clear-input', 'reset', 'bind', 'commands', 'context', 'skills', 'remember', 'dispose', 'settle'])
}
for (const phase of ['adopt', 'reset', 'bind']) {
  const f = fixture()
  f.fail(phase)
  await assert.rejects(f.handoff.newSession(), new RegExp(phase))
  assert.equal(f.calls.filter(call => call === 'release').length, 1)
  assert.equal(f.calls.includes('settle'), false)
}
{
  const f = fixture()
  const open = f.host.open
  f.host.open = async (...args) => { const result = await open(...args); f.cancel(); return result }
  assert.equal(await f.handoff.newSession(), false)
  assert.deepEqual(f.calls.slice(-2), ['abandon', 'release'])
  assert.equal(f.calls.includes('attach'), false)
}
{
  const f = fixture()
  f.fail('open')
  assert.equal(await f.handoff.newSession(), false)
  assert.deepEqual(f.calls.slice(-2), ['notify', 'release'])
}
{
  const f = fixture()
  const compose = f.host.composePreset
  f.host.composePreset = async (...args) => { const result = await compose(...args); f.cancel(); return result }
  assert.equal(await f.handoff.newSession(), false)
  assert.equal(f.calls.includes('reserve'), false)
}
console.log('verify:new-session-planner OK (new handoff order and exactly-once reservation release)')
