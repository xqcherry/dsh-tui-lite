/** Focused reset regression for L4 session adoption across real module owners. */
import assert from 'node:assert/strict'
import { resetSessionProjection } from '../src/modules/sessions/model/session-reset.js'
import { createRuntimeModulesFixture, readRuntimeFixture } from './lib/runtime-modules-fixture.js'

const runtime = createRuntimeModulesFixture()
runtime.publication.batch(() => {
  runtime.transcript.ingress.patch({
    rows: [{ id: 1, kind: 'assistant', text: 'old' }],
    todos: [{ content: 'old', status: 'pending' }],
    goal: { text: 'old' } as never,
    tokens: { input: 1 } as never,
    responseChars: 1,
    activeToolCount: 1,
    lastUserText: 'old',
    spinnerMode: 'tool-use',
    tps: 1,
    tpsSamples: [{ tps: 1, at: 1 }],
    lastUsage: { input: 1 } as never,
    contextSegments: { system: 1 } as never,
  })
  runtime.sessions.ingress.patch({ sessionTitle: 'old', sessionColor: 'red', working: true })
  runtime.composer.ingress.patch({ pending: [{ id: 'old', text: 'old' } as never], cancelPending: true })
})
const rowIds = { value: 9 }
let projectorResets = 0
let subagentResets = 0
let jobResets = 0
let publications = 0
const observeReset = (): void => {
  publications++
  assert.equal(runtime.sessions.store.getSnapshot().working, false)
  assert.equal(runtime.composer.store.getSnapshot().pending.length, 0)
  assert.equal(runtime.transcript.store.getSnapshot().rows.length, 0)
}
const unsubscribe = [runtime.sessions, runtime.composer, runtime.transcript].map(module => module.store.subscribe(observeReset))
try {
  runtime.publication.batch(() => resetSessionProjection(
    runtime,
    rowIds,
    () => { projectorResets += 1 },
    () => { subagentResets += 1 },
    () => { jobResets += 1 },
  ))
  assert.equal(publications, 3, 'each reset owner notifies after all related snapshots commit')
  for (const dispose of unsubscribe) dispose()
  const state = readRuntimeFixture(runtime)
  assert.equal(projectorResets, 1)
  assert.equal(subagentResets, 1)
  assert.equal(jobResets, 1)
  assert.equal(rowIds.value, 0)
  assert.equal(state.rows.length, 0)
  assert.deepEqual(state.todos, [])
  assert.deepEqual(state.pending, [])
  assert.equal(state.goal, undefined)
  assert.equal(state.working, false)
  assert.equal(state.cancelPending, false)
  assert.equal(state.spinnerMode, 'requesting')
  assert.deepEqual({ ...state.contextSegments }, { system: 0, prompt: 0, assistant: 0, thinking: 0, tools: 0 })
  runtime.transcript.ingress.upsertActivityRow('job:one', { kind: 'job', text: 'starting' })
  const first = runtime.transcript.store.getSnapshot()
  runtime.transcript.ingress.upsertActivityRow('job:one', { kind: 'job', text: 'finished' })
  const second = runtime.transcript.store.getSnapshot()
  assert.equal(first.rows[0]!.text, 'starting', 'activity updates preserve old transcript snapshots')
  assert.equal(second.rows[0]!.text, 'finished')
  assert.equal(first.rows[0]!.id, second.rows[0]!.id, 'activity updates retain the sequence anchor')
  assert.equal(second.rows.length, 1)
} finally {
  runtime.dispose()
}
console.log('verify:session-reset OK (common foreground adoption projection reset)')
