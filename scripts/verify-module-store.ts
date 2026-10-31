/** Deterministic publication checks; no renderer, timer waits or model is started. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
assert.ok(existsSync('src/shared/state/module-store.ts'), 'module-owned snapshot storage must exist')
const { createPublication, createModuleStore } = await import('../src/shared/state/module-store.js')
const scheduled: (() => void)[] = []
const publication = createPublication({
  schedule(callback) {
    scheduled.push(callback)
    return () => { const index = scheduled.indexOf(callback); if (index >= 0) scheduled.splice(index, 1) }
  },
})
const left = createModuleStore({ id: 'old', items: [{ label: 'old' }], bytes: Buffer.from('image') }, publication)
const right = createModuleStore({ session: 'old' }, publication)
const rows = createModuleStore({ rows: [{ id: 1, kind: 'text', text: 'before' }] }, publication)
const beforeRows = rows.store.getSnapshot()
rows.update(draft => { draft.rows[0]!.text = 'after' })
assert.equal(rows.store.getSnapshot().rows[0]!.text, 'after', 'ordinary owner updates need no transcript-specific dirty marks')
assert.equal(beforeRows.rows[0]!.text, 'before')
let historyReads = 0
const history = createModuleStore({ status: 'idle', rows: [{ id: 1, kind: 'assistant', get text() { historyReads++; return 'history' } }] }, publication, { trackedRows: true })
const readsBefore = historyReads
history.patch({ status: 'running' })
assert.equal(historyReads, readsBefore, 'unrelated transcript changes do not revisit historical rows')
const original = left.store.getSnapshot()
assert.equal(original, left.store.getSnapshot(), 'unchanged reads retain identity')
assert(Object.isFrozen(original.items[0]))
assert.equal(Buffer.isBuffer(original.bytes), true)
let calls = 0
left.store.subscribe(() => {
  calls++
  assert.equal(left.store.getSnapshot().id, right.store.getSnapshot().session, 'all snapshots install before subscribers run')
})
publication.batch(() => {
  left.patch({ id: 'new' })
  right.patch({ session: 'new' })
  assert.equal(left.store.getSnapshot(), original, 'batch hides unfinished snapshots')
  assert.equal(left.read().id, 'new', 'owner reads see preceding batch writes')
  assert(Object.isFrozen(left.read().items[0]), 'owner reads cannot leak mutable structures')
})
assert.equal(calls, 1)
assert.equal(original.id, 'old')
assert.equal(left.store.getSnapshot().items[0], original.items[0], 'unchanged rows retain identity')
const stable = left.store.getSnapshot()
right.patch({ session: 'other' })
assert.equal(left.store.getSnapshot(), stable, 'unrelated modules do not invalidate a snapshot')
right.patch({ session: 'new' })
left.patch({ id: 'new' })
assert.equal(left.store.getSnapshot(), stable, 'equal patches do not publish')
left.update(() => {})
assert.equal(calls, 1, 'no-op updates do not notify unchanged owners')
publication.batch(() => {
  left.patch({ id: 'stream' })
  right.patch({ session: 'stream' })
}, 'stream')
assert.equal(left.store.getSnapshot().id, 'stream', 'stream ingress is readable synchronously')
assert.equal(calls, 1, 'stream subscribers wait for one scheduled wake')
assert.equal(scheduled.length, 1)
publication.batch(() => left.read())
assert.equal(calls, 1, 'read-only command batches preserve the pending stream wake')
scheduled.shift()!()
assert.equal(calls, 2)
publication.batch(() => {
  left.patch({ id: 'silent' })
  right.patch({ session: 'silent' })
}, 'silent')
assert.equal(left.store.getSnapshot().id, 'silent')
assert.equal(calls, 2, 'wake none commits without scheduling notifications')
assert.equal(scheduled.length, 0)
publication.flush()
assert.equal(calls, 3)
let reentries = 0
right.store.subscribe(() => {
  if (right.store.getSnapshot().session === 'reenter' && reentries++ === 0) right.patch({ session: 'settled' })
})
right.patch({ session: 'reenter' })
assert.equal(right.store.getSnapshot().session, 'settled')
publication.dispose()
left.patch({ id: 'disposed' })
assert.equal(calls, 3)
assert.equal(scheduled.length, 0)
console.log('Module storage passed: stable immutable snapshots, atomic publication, stream coalescing and teardown')
