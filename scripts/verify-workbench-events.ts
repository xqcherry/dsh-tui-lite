/** Foreground event orchestration uses module-owned semantic ports. */
import assert from 'node:assert/strict'
import { createSessionBatchRouter } from '../src/modules/workbench/model/session-batch.js'
import { createWorkbenchProjection } from '../src/modules/workbench/model/projection.js'
import { resetSessionProjection } from '../src/modules/workbench/model/session-reset.js'
import { createRuntimeModulesFixture } from './lib/runtime-modules-fixture.js'
import type { AgentEvent } from '../src/shared/protocol/events.js'

const runtime = createRuntimeModulesFixture()
const inputConvergence = runtime.composer.ingress.convergence
inputConvergence.cancelInFlight = true
const rowIds = { value: 0 }
const stages: string[] = []
const projector = createWorkbenchProjection(runtime, {
  rowIds,
  resetContextWarning: () => undefined,
  checkContextWarning: () => undefined,
  notify: () => () => undefined,
  jobs: { onOutputSeen: () => undefined, onStarted: () => undefined },
  selectionAttached: () => undefined,
  renderer: {
    render(_type, data) {
      stages.push(`${String(data)}:${runtime.sessions.store.getSnapshot().working}:${runtime.composer.store.getSnapshot().pending.length}`)
      return undefined
    },
  },
})
let publications = 0
const retired: string[] = []
const warnings: string[] = []
const router = createSessionBatchRouter({
  sessions: runtime.sessions.ingress,
  composer: runtime.composer.ingress,
  transcript: runtime.transcript.ingress,
  publication: runtime.publication,
  publish: () => undefined,
  projector,
  retireAttachment: id => { retired.push(id) },
  warn: text => { warnings.push(text) },
  onReset: () => {
    stages.push('reset')
    resetSessionProjection(runtime, rowIds, projector.reset, () => {
      assert.equal(runtime.transcript.ingress.read().rows.length, 0)
      stages.push('subagents')
    }, () => { stages.push('jobs') })
  },
})
const unsubscribe = runtime.sessions.store.subscribe(() => { publications++ })
try {
  runtime.composer.ingress.setPending([
    { id: 'claimed', text: 'claimed', placement: 'followup', images: [] },
    { id: 'docked', text: 'docked', placement: 'followup', images: [], docked: true },
  ])
  // The entire prepass precedes projection, including events after reset.
  // Read the uncommitted facts from the semantic context in renderer hooks.
  const snapshots: string[] = []
  const checkingProjector = {
    ...projector,
    apply(events: readonly AgentEvent[], meta: Parameters<typeof projector.apply>[1]) {
      snapshots.push(`${events.map(event => event.type).join(',')}:${runtime.composer.ingress.read().pending.map(item => item.id).join(',')}:${runtime.sessions.ingress.read().status}`)
      projector.apply(events, meta)
    },
  }
  const ordered = createSessionBatchRouter({
    sessions: runtime.sessions.ingress,
    composer: runtime.composer.ingress,
    transcript: runtime.transcript.ingress,
    publication: runtime.publication,
    publish: () => undefined,
    projector: checkingProjector,
      warn: text => { warnings.push(text) },
    retireAttachment: id => { retired.push(id) },
    onReset: () => { stages.push('split') },
  })
  ordered.route([
    { type: 'turn.start', turn: 1, origin: 'user', time: 10 },
    { type: 'session.reset', trigger: 'clear' },
    { type: 'pending.changed', items: [], claimed: ['claimed'], discarded: ['docked'] },
    { type: 'session.status', status: 'running' },
    { type: 'session.reset', trigger: 'clear' },
    { type: 'session.title', title: 'after' },
  ], { replay: false, wake: 'none' }, () => true)
  assert.deepEqual(snapshots, [
    'turn.start:docked:running',
    'pending.changed,session.status:docked:running',
    'session.title:docked:running',
  ])
  assert.deepEqual(stages, ['split', 'split'])
  assert.deepEqual(retired, ['docked'])
  assert.equal(ordered.turnStarts(), 1)
  assert.equal(publications, 0, 'wake:none commits without waking subscribers')
  assert.equal(runtime.sessions.store.getSnapshot().sessionTitle, 'after')
  runtime.publication.flush()
  assert.equal(publications, 1, 'one atomic sessions publication after silent route')

  // Projection lifecycle writes happen before the next event in this batch.
  stages.length = 0
  runtime.composer.ingress.setCancelPending(true)
  const lifecycle: string[] = []
  const inspect = createWorkbenchProjection(runtime, {
    rowIds,
    resetContextWarning: () => undefined, checkContextWarning: () => undefined,
    notify: () => () => undefined,
    jobs: { onOutputSeen: () => undefined, onStarted: () => undefined },
    selectionAttached: () => undefined,
    renderer: { render() {
      lifecycle.push(`${runtime.sessions.ingress.read().working}:${runtime.composer.ingress.read().cancelPending}`)
      return undefined
    } },
  })
  inspect.apply([
    { type: 'turn.start', turn: 2, origin: 'user', time: 20 },
    { type: 'custom', nativeType: 'probe', data: null },
    { type: 'turn.end', turn: 2, reason: { kind: 'completed' }, time: 30 },
    { type: 'custom', nativeType: 'probe', data: null },
  ], { replay: false })
  assert.deepEqual(lifecycle, ['true:false', 'false:false'])

  runtime.transcript.ingress.appendLocalRow({ id: 99, kind: 'assistant', text: 'before' })
  router.route([
    { type: 'session.reset', trigger: 'clear' },
    { type: 'session.title', title: 'replacement' },
  ], { replay: false }, () => true)
  assert.deepEqual(stages, ['reset', 'subagents', 'jobs'])
  assert.equal(runtime.transcript.store.getSnapshot().rows.length, 0)
  assert.equal(runtime.sessions.store.getSnapshot().sessionTitle, 'replacement')

  const before = runtime.sessions.store.getSnapshot()
  router.route([{ type: 'turn.start', turn: 3, origin: 'user', time: 40 }], { replay: false }, () => false)
  assert.strictEqual(runtime.sessions.store.getSnapshot(), before, 'stale generation changes no state')
  assert.equal(router.turnStarts(), 0)
  router.route([{ type: 'compaction.progress', outputChars: 10 }], { replay: false }, () => true)
  assert.equal(runtime.sessions.store.getSnapshot().compaction, undefined, 'closed compaction rejects stale progress')
  assert.equal(warnings.length, 0)
} finally {
  unsubscribe()
  runtime.dispose()
}
console.log('verify:workbench-events OK (semantic stages, prepass, reset segmentation and publication)')
