import assert from 'node:assert/strict'
import { resetAdoptedSession } from '../src/modules/workbench/model/session-adoption.js'
import { createRuntimeModulesFixture } from './lib/runtime-modules-fixture.js'

for (const clearLoadedContext of [true, false]) {
  const runtime = createRuntimeModulesFixture()
  try {
    runtime.publication.batch(() => {
      runtime.sessions.ingress.setWorking(true)
      runtime.sessions.ingress.adoptWorkspace('/old', 'old')
      runtime.sessions.ingress.adoptIdentity({ status: 'idle', agentId: 'old', sessionId: 'old', agentPreset: 'old' })
      runtime.settings.ingress.adoptRoute({ provider: 'old', model: 'old' })
      runtime.settings.ingress.setContextWindow(100)
      runtime.settings.ingress.setEffortLevels(['old'])
      runtime.settings.ingress.setReasoningEffort('old')
      runtime.transcript.ingress.appendLocalRow({ id: 7, kind: 'assistant', text: 'old' })
      runtime.transcript.ingress.setLoadedContext({ sections: [], contexts: [], files: [], skills: [], tools: [] })
    })
    const previous = runtime.transcript.store.getSnapshot()
    const calls: string[] = []
    const rowIds = { value: 8 }
    let publications = 0
    const unsubscribe = runtime.sessions.store.subscribe(() => {
      publications++
      assert.equal(runtime.sessions.store.getSnapshot().agentId, 'next-agent')
      assert.equal(runtime.settings.store.getSnapshot().model, 'next-model')
      assert.equal(runtime.transcript.store.getSnapshot().rows.length, 0)
    })
    runtime.publication.batch(() => resetAdoptedSession(runtime, {
      identity: { status: 'running', agentId: 'next-agent', sessionId: 'next-session', agentPreset: 'next-preset' },
      route: { provider: 'next-provider', model: 'next-model' },
      clearLoadedContext,
    }, {
      rowIds,
      resetProjector: () => calls.push('projector'),
      resetSubagents: () => calls.push('subagents'),
      resetJobs: () => calls.push('jobs'),
    }))
    unsubscribe()
    assert.equal(publications, 1)
    assert.deepEqual(calls, ['projector', 'subagents', 'jobs'])
    assert.equal(rowIds.value, 0)
    assert.equal(previous.rows[0]!.text, 'old', 'adoption keeps published transcript snapshots independent')
    const session = runtime.sessions.store.getSnapshot()
    assert.equal(session.agentId, 'next-agent')
    assert.equal(session.sessionId, 'next-session')
    assert.equal(session.agentPreset, 'next-preset')
    assert.equal(session.status, 'running')
    assert.equal(session.working, false, 'post-replay working is set by the operation tail')
    assert.equal(session.cwd, '/old', 'cwd is committed at the operation-specific stage')
    const settings = runtime.settings.store.getSnapshot()
    assert.equal(settings.provider, 'next-provider')
    assert.equal(settings.model, 'next-model')
    assert.equal(settings.contextWindow, undefined)
    assert.equal(settings.effortLevels, undefined)
    assert.equal(settings.reasoningEffort, undefined)
    assert.equal(runtime.transcript.store.getSnapshot().loadedContext === undefined, clearLoadedContext, 'fork retains loaded context while new/resume clears it')
  } finally { runtime.dispose() }
}
console.log('verify:session-adoption OK (semantic module writes, atomic snapshots and operation-specific context reset)')
