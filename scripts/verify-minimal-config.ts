/** Source regression: plugin configuration has no removed UI features. */
import assert from 'node:assert/strict'
import { Config } from '../src/dsh-adapter/index.js'
assert.deepEqual(Object.keys(Config.dict ?? {}).sort(), [
  'cwd', 'effort', 'model', 'preset', 'provider', 'sessionId',
].sort())
console.log('Minimal plugin configuration passed')
