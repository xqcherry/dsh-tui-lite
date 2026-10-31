/** Activity ownership regression checks; no agent/model/service is started. */
import assert from 'node:assert/strict'
import { createActivityModule } from '../src/modules/activity/model/module.js'
import { createActivitySubagentProjection } from '../src/modules/activity/model/subagent-projection.js'
import { createJobProjection } from '../src/dsh-adapter/channel/job-projection.js'
import { createPublication } from '../src/shared/state/module-store.js'
import { createChannelOwner } from '../src/shared/lifecycle/owner.js'
import type { ActivityProjectionHost, ActivityTranscriptTarget, SubagentCostPolicy } from '../src/modules/activity/model-contracts.js'
import type { BackgroundJobSnapshot, KernelJobEvent } from '../src/modules/activity/model/jobs.js'
import type { CostTokenBuckets } from '../src/shared/protocol/transcript.js'

const emptyBuckets = (): CostTokenBuckets => ({ peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, idle: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })
const policy: SubagentCostPolicy = {
  empty: emptyBuckets,
  clone: buckets => ({ peak: { ...buckets.peak }, idle: { ...buckets.idle } }),
  add(buckets, usage, peak) {
    const bucket = peak ? buckets.peak : buckets.idle
    bucket.input += usage.input
    bucket.output += usage.output
    bucket.cacheRead += usage.cacheRead
    bucket.cacheWrite += usage.cacheWrite
  },
  isPeakHour: () => false,
  isPriced: () => true,
}
const scheduled: (() => void)[] = []
const publication = createPublication({ schedule(callback) {
  scheduled.push(callback)
  return () => { const index = scheduled.indexOf(callback); if (index >= 0) scheduled.splice(index, 1) }
} })
const activity = createActivityModule({
  options: { model: 'model', provider: 'provider', cwd: '/tmp' },
  input: { agentId: 'parent-a', sessionId: 'parent-a', mode: { id: 'agent', label: 'Agent' }, cwdDescription: '/tmp' },
}, { listSubagents: async () => [], jobControl: { kill: () => false }, subagentControl: { interrupt: () => false } }, publication)

type ActivityRowInput = Parameters<ActivityTranscriptTarget['ingress']['upsertActivityRow']>[1]
const rows: (ActivityRowInput & { id: number })[] = []
const anchors = new Map<string, number>()
let nextId = 1
const transcript: ActivityTranscriptTarget = { ingress: {
  upsertActivityRow(key, row) {
    let index = anchors.get(key)
    if (index === undefined) { index = rows.length; anchors.set(key, index); rows.push({ id: nextId++, ...row }) }
    else rows[index] = { ...rows[index], ...row }
  },
  resetActivityRows(kind) { for (const key of anchors.keys()) if (key.startsWith(`${kind}:`)) anchors.delete(key) },
} }
let parent: ActivityProjectionHost = { id: 'parent-a', session: { id: 'parent-a' } }
const parentA = parent
const owner = createChannelOwner()
const jobs = createJobProjection(activity, transcript, { owner, agent: () => parent, emit() {}, notify() {}, steer() {} })
let roster: BackgroundJobSnapshot[] = [
  { id: 'job-a', kind: 'bash', label: 'first', status: 'running', startedAt: 10, output: { earliest: 5, total: 5 } },
  { id: 'job-b', kind: 'bash', label: 'second', status: 'running', startedAt: 11 },
]
let listener: (event: KernelJobEvent) => void = () => undefined
const cursors: number[] = []
let detached = 0
let consumingReads = 0
jobs.attach({
  list(caller) { assert.equal(caller, parent.id); return roster },
  kill(_id, caller) { assert.equal(caller, parent.id) },
  events: { subscribe(_filter, callback) { listener = callback; return () => { detached++ } } },
  readAt(_id, cursor, caller) {
    assert.equal(caller, parent.id)
    cursors.push(cursor)
    return cursor === 5
      ? { chunks: [{ at: 5, text: 'one\npart', channel: 'stderr' as const }], next: 13 }
      : { chunks: [{ at: 13, text: 'ial\n' }], next: 17 }
  },
  // A consuming reader must remain entirely outside the UI projection.
  ...{ read() { consumingReads++; throw new Error('consuming output read') } },
})
assert.deepEqual(rows.map(row => row.kind), ['job', 'job'])
const originalIds = rows.map(row => row.id)
const before = activity.store.getSnapshot()
listener({ type: 'output', id: 'job-a', total: 13 })
listener({ type: 'output', id: 'job-a', total: 17 })
assert.deepEqual(cursors, [5, 13])
assert.equal(activity.store.getSnapshot().backgroundJobs[0].outputTotalBytes, 17)
assert.equal(consumingReads, 0)
assert.deepEqual(activity.store.getSnapshot().backgroundJobs[0].outputLines.map(line => line.text), ['one', 'partial'])
assert.equal(activity.store.getSnapshot().backgroundJobs[0].outputLines[0].channel, 'stderr')
assert.deepEqual(rows.map(row => row.id), originalIds, 'activity updates retain transcript anchors/order')
assert.deepEqual(before.backgroundJobs[0].outputLines, [], 'published snapshots cannot mutate behind readers')
roster = []
parent = { id: 'parent-b', session: { id: 'parent-b' } }
jobs.reanchor()
assert.equal(activity.store.getSnapshot().backgroundJobs.length, 0, 'a new session owns a fresh roster and cursor')
owner.dispose()
owner.dispose()
listener({ type: 'output', id: 'job-a', total: 99 })
assert.equal(detached, 1, 'host subscription cleanup happens once')
assert.deepEqual(cursors, [5, 13], 'revoked callbacks cannot read a host service')

parent = parentA
const childSession = { id: 'child-a' }
const children = new Map([['child-a', { status: 'running', session: childSession, options: { provider: 'official', model: 'model-a' } }]])
const subagents = createActivitySubagentProjection(activity, transcript, {
  agent: () => parent, emit() {}, emitStream() {}, costPolicy: policy,
  subagents: () => undefined,
  lookupChild: id => children.get(id),
})
subagents.onParentEvent({ type: 'tool/call', data: { name: 'task', arguments: '{"description":"first child"}' } })
subagents.onParentEvent({ type: 'tool/call', data: { name: 'task', arguments: '{"description":"second child"}' } })
subagents.onStart({ id: 'child-a', provider: 'official', runId: 'epoch-1' }, parentA)
subagents.onStart({ id: 'child-b', provider: 'official', runId: 'other' }, parentA)
assert.equal(subagents.store.get('child-a')?.description, 'first child')
assert.equal(subagents.store.get('child-b')?.description, 'second child', 'delegation descriptions retain FIFO order')
const usage = { type: 'assistant/message', seq: 7, time: 10, data: { usage: { inputTokens: 10, outputTokens: 4 } } }
subagents.onSessionEvent(childSession, usage)
subagents.onSessionEvent(childSession, usage)
assert.equal(activity.store.getSnapshot().subagentCost[0].buckets.idle.input, 10, 'durable usage is charged once by seq')
subagents.onStart({ id: 'child-a', provider: 'official', runId: 'epoch-2' }, parentA)
subagents.onEnd({ id: 'child-a', runId: 'epoch-1', stopReason: 'completed' }, parentA)
assert.equal(subagents.store.get('child-a')?.status, 'running', 'a stale epoch end cannot settle the current epoch')
subagents.onStreamFrame({ session: childSession }, { type: 'start', revision: 1, attemptId: 'attempt', turn: 1, step: 1 })
let activityNotifications = 0
const offActivity = activity.store.subscribe(() => { activityNotifications++ })
const beforeStream = activity.store.getSnapshot()
subagents.onStreamFrame({ session: childSession }, { type: 'chunk', revision: 2, attemptId: 'attempt', chunk: { type: 'text-delta', text: 'transient' } })
assert.deepEqual(activity.store.getSnapshot().subagents[0].output, ['transient'], 'frame chunks install readable activity immediately')
assert.deepEqual(rows.find(row => row.subagent?.agentId === 'child-a')?.subagent?.outputLines, ['transient'], 'frame chunks mirror transcript rows in the same transaction')
subagents.onStreamFrame({ session: childSession }, { type: 'chunk', revision: 3, attemptId: 'attempt', chunk: { type: 'text-delta', text: '-more' } })
assert.deepEqual(activity.store.getSnapshot().subagents[0].output, ['transient-more'])
subagents.onSessionEvent(childSession, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: ' legacy' } } })
assert.deepEqual(activity.store.getSnapshot().subagents[0].output, ['transient-more legacy'], 'legacy session chunks are also readable before the scheduled wake')
assert.deepEqual(rows.find(row => row.subagent?.agentId === 'child-a')?.subagent?.outputLines, ['transient-more legacy'])
assert.deepEqual(beforeStream.subagents[0].output, [], 'stream ingress leaves preceding snapshots detached')
assert.equal(activityNotifications, 0, 'stream ingress defers notifications only')
assert.equal(scheduled.length, 1, 'multiple chunk ingresses share one scheduled wake')
scheduled.shift()!()
assert.equal(activityNotifications, 1, 'the coalesced wake publishes one notification')
offActivity()
subagents.park(parentA)
parent = { id: 'parent-b', session: { id: 'parent-b' } }
subagents.reset()
subagents.onSessionEvent(childSession, { type: 'assistant/message', seq: 8, data: { turn: 1, step: 1, stream: [], message: { content: [{ type: 'text', text: 'durable' }] } } })
assert.equal(activity.store.getSnapshot().subagents.length, 0, 'parked parent events cannot overwrite visible activity')
subagents.onEnd({ id: 'child-a', runId: 'epoch-2', stopReason: 'completed' }, parentA)
parent = parentA
subagents.restore(parentA)
subagents.syncNow()
assert.equal(subagents.store.get('child-a')?.status, 'completed')
assert.deepEqual(subagents.store.get('child-a')?.output, ['durable'], 'parked stream attempt state settles from durable content')
assert.equal(activity.store.getSnapshot().subagentCost[0].buckets.idle.output, 4, 'cost identity survives park/restore')
subagents.dispose()
subagents.dispose()
activity.dispose()
publication.dispose()
console.log('Activity owners passed: session fences, output cursors, transcript anchors, FIFO, durable costs and parked epochs')
