import assert from 'node:assert/strict'
import { createRuntimeModulesFixture } from './lib/runtime-modules-fixture.js'
import type { ChatRow } from '../src/shared/protocol/transcript.js'

const runtime = createRuntimeModulesFixture()
const restored: ChatRow = { id: 1, seq: 8, kind: 'tool', text: '', folded: true, tool: { callId: 'past', name: 'Bash', argsText: '{}', status: 'ok', startedAt: 0 } }
const live: ChatRow = { id: 2, seq: 9, kind: 'tool', text: '', tool: { callId: 'live', name: 'Bash', argsText: '{}', status: 'running', startedAt: 1 } }
const restoredTool = restored.tool
const liveTool = live.tool
try {
  runtime.transcript.ingress.appendLocalRow(restored)
  runtime.transcript.ingress.appendLocalRow(live)
  const before = runtime.transcript.store.getSnapshot()
  const rows = runtime.transcript.ingress.read().rows.map(row => ({ ...row, ...(row.tool === undefined ? {} : { tool: { ...row.tool } }) }))
  rows[0]!.folded = false
  rows[0]!.tool!.argsFull = '{"command":"pwd"}'
  rows[0]!.tool!.resultFull = '/fixture'
  runtime.transcript.ingress.restoreHistoryRows(rows)
  assert.equal(restored.tool, restoredTool, 'history restoration preserves owned tool identity')
  assert.equal(live.tool, liveTool, 'restoring history must not replace a live tool with an immutable read projection')
  assert.equal(restored.tool?.resultFull, '/fixture')
  assert.equal(restored.id, 1)
  assert.equal(restored.seq, 8)
  assert.equal(before.rows[0]?.folded, true, 'old snapshots stay detached')
  assert.equal(runtime.transcript.store.getSnapshot().rows[1], before.rows[1], 'untouched live rows retain their read identity')
} finally { runtime.dispose() }
console.log('Transcript restoration passed: sequence anchors, owned tools and independent snapshots')
