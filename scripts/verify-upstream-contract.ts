/** One supported runtime line, one Cordis instance, and a fail-loud host guard. */
import assert from 'node:assert/strict'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.dependencies['@deepseek-ai/dsh']
assert.equal(version, '0.2.0-rc.2')
assert.equal(pkg.dependencies['@deepseek-ai/dsh-agent'], version, 'agent is a pinned production dependency')
for (const [name, value] of Object.entries(pkg.dependencies)) {
  if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(value, version, `${name} must match the runtime`)
}
assert.equal(pkg.peerDependencies, undefined, 'the CLI must not depend on optional peer installation')
const ownRequire = createRequire(import.meta.url)
const hostRequire = createRequire(ownRequire.resolve('@deepseek-ai/dsh/package.json'))
for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-session']) {
  assert.equal(realpathSync(ownRequire.resolve(name)), realpathSync(hostRequire.resolve(name)), `${name}: client and runtime must share identity`)
}
const { assertUpstreamRuntime } = await import('../src/dsh-adapter/contract.js')
assertUpstreamRuntime()
assert.throws(() => assertUpstreamRuntime({ '@deepseek-ai/dsh-agent': '0.1.0-rc.6' }), /runtime.*mismatch|unsupported/i)
console.log('Upstream contract passed: pinned runtime and shared service identity')
