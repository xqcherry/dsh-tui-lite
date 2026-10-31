/** Lightweight port projection checks: no terminal renderer or model is started. */
import assert from 'node:assert/strict'
import { createWorkbenchPorts } from '../src/dsh-adapter/runtime/ports.js'

const source = {
  agentId: 'session-a',
  agentBindingGeneration: 7,
  stagedImageGeneration: () => 99,
  model: 'model-a',
  rows: [],
}
const ports = createWorkbenchPorts(source as unknown as Parameters<typeof createWorkbenchPorts>[0])
assert.equal(Reflect.get(ports.composer, 'agentBindingGeneration'), 7, 'composer must retain the session binding fence, not fall back to attachment generation')
assert.equal('deleteSession' in ports.composer, false, 'composer must not receive session deletion authority')
assert.equal('providerSetup' in ports.transcript, false, 'transcript must not receive provider configuration authority')
source.agentBindingGeneration = 8
source.model = 'model-b'
assert.equal(Reflect.get(ports.composer, 'agentBindingGeneration'), 8, 'port reads must stay live across rebinding')
assert.equal(ports.settings.model, 'model-b', 'model changes must remain observable')
assert.equal(Reflect.set(ports.settings, 'model', 'invalid'), false, 'port properties must be read-only')
assert.equal(source.model, 'model-b')
console.log('Feature ports passed: binding generation, narrow authority, live reads and read-only properties')
