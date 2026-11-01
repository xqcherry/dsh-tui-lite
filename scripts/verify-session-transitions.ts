import assert from 'node:assert/strict'
import { createModelFork, createPersistedSessionResume } from '../src/modules/sessions/model/session-transitions.js'
import type { ModelForkHost, PersistedSessionResumeHost } from '../src/modules/sessions/model/session-transitions.js'

function fixture() {
  const calls: string[] = []
  const candidate = Symbol('candidate')
  const capture = Symbol('capture')
  const entry = Symbol('entry')
  const plan = Symbol('plan')
  const seed = Symbol('seed')
  let current = true
  let sameEntry = true
  let failAt = ''
  let mounted = false
  let working = false
  const record = (name: string): void => {
    calls.push(name)
    if (failAt === name) throw new Error(name)
  }
  const reservation = { settle: () => record('settle'), abandon: () => record('release') }
  const shared = {
    capture: () => capture,
    available: () => true,
    working: () => working,
    bindingCurrent: () => current,
    current: () => true,
    settleCompaction: async () => { record('compaction') },
    abandon: async () => { record('abandon') },
    adopt<Result>(_candidate: symbol, _capture: symbol, tail: (dispose: (next: 'dispose' | 'park') => void) => Result): Result {
      record('adopt')
      return tail(() => record('dispose'))
    },
    clearStagedImages: () => record('clear-input'),
    bindAgent: () => record('bind'),
    refreshCommands: () => record('commands'),
    refreshLoadedContext: async () => { record('context') },
    refreshSkillCommands: async () => { record('skills') },
    settleReplay: () => record('settle-replay'),
    setReplayStatus: () => record('status'),
    publish: () => record('publish'),
    notify: () => { record('notify'); return () => {} },
  }
  const resume: PersistedSessionResumeHost<symbol, symbol, symbol, symbol> = {
    ...shared,
    entry: () => ({ identity: entry, sessionId: 'old' }),
    sameEntry: () => sameEntry,
    waitForDisposal: async () => { record('wait') },
    liveMounted: () => mounted,
    localPid: 17,
    reserve: async () => { record('reserve'); return { ok: true, reservation } },
    plan: async () => { record('plan'); return plan },
    prepare: async () => { record('prepare'); return candidate },
    attach: async () => { record('attach') },
    commitWorkspace: () => record('cwd'),
    resetIdeSelection: () => record('ide'),
    refreshGitBranch: () => record('git'),
    reset: () => record('reset'),
    replay: () => record('replay'),
    remember: () => record('remember'),
  }
  const fork: ModelForkHost<symbol, symbol, symbol, symbol, symbol> = {
    ...shared,
    snapshot: () => { record('snapshot'); return seed },
    reserve: async () => { record('reserve'); return { resource: Symbol('child'), reservation } },
    preset: async () => { record('preset'); return plan },
    prepare: async () => { record('prepare'); return candidate },
    attach: async () => { record('attach') },
    reset: () => record('reset'),
    dropModelCompletion: () => record('drop-completion'),
    replay: () => record('replay'),
    remember: () => record('remember'),
    writeModelPref: () => { record('pref'); return true },
  }
  return { calls, resume, fork, cancel: () => { current = false }, changeEntry: () => { sameEntry = false }, fail: (name: string) => { failAt = name }, mount: () => { mounted = true }, work: () => { working = true } }
}

{
  const f = fixture()
  assert.deepEqual(await createPersistedSessionResume(f.resume)('disk'), { ok: true })
  assert.deepEqual(f.calls, ['wait', 'reserve', 'compaction', 'plan', 'prepare', 'attach', 'adopt', 'cwd', 'ide', 'git', 'clear-input', 'reset', 'replay', 'settle-replay', 'status', 'bind', 'commands', 'context', 'skills', 'remember', 'publish', 'dispose', 'settle'])
}
{
  const f = fixture()
  assert.equal(await createModelFork(f.fork)('provider', 'model'), true)
  assert.deepEqual(f.calls, ['compaction', 'snapshot', 'reserve', 'preset', 'prepare', 'attach', 'adopt', 'reset', 'drop-completion', 'replay', 'settle-replay', 'status', 'clear-input', 'bind', 'commands', 'context', 'skills', 'remember', 'publish', 'dispose', 'pref', 'settle'])
}
for (const phase of ['plan', 'adopt', 'reset', 'replay', 'bind']) {
  const f = fixture()
  f.fail(phase)
  await assert.rejects(createPersistedSessionResume(f.resume)('disk'), new RegExp(phase))
  assert.equal(f.calls.filter(call => call === 'release').length, 1, `resume ${phase} releases exactly once`)
  assert.equal(f.calls.includes('settle'), false)
}
for (const phase of ['adopt', 'reset', 'replay', 'bind']) {
  const f = fixture()
  f.fail(phase)
  await assert.rejects(createModelFork(f.fork)('provider', 'model'), new RegExp(phase))
  assert.equal(f.calls.filter(call => call === 'release').length, 1, `fork ${phase} releases exactly once`)
  assert.equal(f.calls.includes('pref'), false)
}
{
  const f = fixture()
  f.fail('prepare')
  assert.deepEqual(await createPersistedSessionResume(f.resume)('disk'), { ok: false, reason: 'failed', error: 'prepare' })
  assert.deepEqual(f.calls.slice(-2), ['notify', 'release'])
}
{
  const f = fixture()
  f.fail('prepare')
  assert.equal(await createModelFork(f.fork)('provider', 'model'), false)
  assert.deepEqual(f.calls.slice(-2), ['release', 'notify'])
}
{
  const f = fixture()
  const prepare = f.resume.prepare
  f.resume.prepare = async (...args) => { const result = await prepare(...args); f.cancel(); return result }
  assert.deepEqual(await createPersistedSessionResume(f.resume)('disk'), { ok: false, reason: 'cancelled' })
  assert.deepEqual(f.calls.slice(-2), ['abandon', 'release'])
  assert.equal(f.calls.includes('attach'), false)
}
{
  const f = fixture()
  const attach = f.resume.attach
  f.resume.attach = async (...args) => { await attach(...args); f.changeEntry() }
  assert.deepEqual(await createPersistedSessionResume(f.resume)('disk'), { ok: false, reason: 'failed', error: 'live session changed during resume' })
  assert.deepEqual(f.calls.slice(-3), ['abandon', 'notify', 'release'])
}
{
  const f = fixture()
  const settle = f.resume.settleCompaction
  f.resume.settleCompaction = async () => { await settle(); f.work() }
  assert.deepEqual(await createPersistedSessionResume(f.resume)('disk'), { ok: false, reason: 'cancelled' })
  assert.deepEqual(f.calls, ['wait', 'reserve', 'compaction', 'release'])
}
{
  const f = fixture()
  const attach = f.fork.attach
  f.fork.attach = async (...args) => { await attach(...args); f.cancel() }
  assert.equal(await createModelFork(f.fork)('p', 'm'), false)
  assert.deepEqual(f.calls.slice(-2), ['abandon', 'release'])
}
{
  const f = fixture()
  f.mount()
  assert.deepEqual(await createPersistedSessionResume(f.resume)('disk'), { ok: false, reason: 'occupied', pid: 17 })
  assert.deepEqual(f.calls, ['wait'])
}
{
  const f = fixture()
  const wait = f.resume.waitForDisposal
  f.resume.waitForDisposal = async (...args) => { await wait(...args); f.cancel() }
  assert.deepEqual(await createPersistedSessionResume(f.resume)('disk'), { ok: false, reason: 'cancelled' })
  assert.deepEqual(f.calls, ['wait'])
}
{
  const f = fixture()
  f.resume.reserve = async () => ({ ok: false, result: { ok: false, reason: 'failed', error: 'ledger refused' } })
  assert.deepEqual(await createPersistedSessionResume(f.resume)('disk'), { ok: false, reason: 'failed', error: 'ledger refused' })
  assert.deepEqual(f.calls, ['wait'])
}
{
  const f = fixture()
  let availabilityReads = 0
  f.resume.available = () => ++availabilityReads === 1
  assert.deepEqual(await createPersistedSessionResume(f.resume)('disk'), { ok: false, reason: 'unavailable' })
  assert.deepEqual(f.calls, ['wait', 'reserve', 'compaction', 'notify', 'release'])
}
{
  const f = fixture()
  f.fail('attach')
  assert.deepEqual(await createPersistedSessionResume(f.resume)('disk'), { ok: true })
  assert.equal(f.calls.at(-1), 'settle', 'workspace attachment failure remains a warning')
}
{
  const f = fixture()
  f.fail('attach')
  assert.equal(await createModelFork(f.fork)('p', 'm'), true)
  assert.equal(f.calls.at(-1), 'settle', 'fork workspace attachment failure remains a warning')
}
{
  const f = fixture()
  const settle = f.fork.settleCompaction
  f.fork.settleCompaction = async () => { await settle(); f.work() }
  assert.equal(await createModelFork(f.fork)('p', 'm'), true, 'model fork preserves its policy without adding new resume/new race checks')
  assert.equal(f.calls.at(-1), 'settle')
}
{
  const f = fixture()
  f.fork.writeModelPref = () => false
  assert.equal(await createModelFork(f.fork)('p', 'm'), true)
  assert.deepEqual(f.calls.slice(-3), ['dispose', 'notify', 'settle'], 'preference failure is a post-publication warning')
}
console.log('verify:session-transitions OK (resume and model fork order, cancellation, failed adoption, reservations)')
