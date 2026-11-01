/** Normalized task facts become owned snapshots and stable transcript rows. */
import assert from 'node:assert/strict'
import { createJobPresentation } from '../src/modules/activity/model/job-presentation.js'
import { createRuntimeModulesFixture } from './lib/runtime-modules-fixture.js'

const runtime = createRuntimeModulesFixture()
let current = true
let emits = 0
const notices: string[] = []
const projection = createJobPresentation(runtime.activity, runtime.transcript, {
  current: () => current,
  notify: text => { notices.push(text) },
  emit: () => { emits++ },
})
try {
  projection.store.replace([{ id: 'job', kind: 'bash', label: 'Build', status: 'running', startedAt: 100, output: { earliest: 0, total: 0 } }])
  const first = runtime.transcript.store.getSnapshot().rows[0]!
  assert.equal(first.kind, 'job')
  assert.equal(runtime.activity.store.getSnapshot().backgroundJobs[0]!.id, 'job')
  projection.store.replace([{ id: 'job', kind: 'bash', label: 'Build', status: 'completed', startedAt: 100, finishedAt: 300, output: { earliest: 0, total: 0 } }])
  const finished = runtime.transcript.store.getSnapshot().rows[0]!
  assert.equal(finished.id, first.id)
  assert.equal(finished.job!.status, 'completed')
  assert.equal(first.job!.status, 'running', 'older snapshot remains unchanged')
  assert.equal(notices.length, 1)
  assert.equal(emits, 2)
  current = false
  projection.store.replace([{ id: 'foreign', kind: 'bash', label: 'Other', status: 'running', startedAt: 500, output: { earliest: 0, total: 0 } }])
  assert.equal(runtime.transcript.store.getSnapshot().rows.length, 1)
  assert.equal(emits, 2)
} finally { runtime.dispose() }
console.log('Activity presentation passed: stable row identity, owned snapshots, notifications and revoked attachment')
