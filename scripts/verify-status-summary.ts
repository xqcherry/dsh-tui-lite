import assert from 'node:assert/strict'
import { formatStatusLines } from '../src/modules/workbench/model/status-summary.js'

const lines = formatStatusLines({
  status: 'idle',
  provider: 'deepseek-official',
  model: 'deepseek-flash',
  cwd: '/workspace',
  contextWindow: 100,
  contextOccupancy: { usedTokens: 50, contextWindow: 100, source: 'projection' },
  tokens: {
    input: 1_000_000,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    peak: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
    idle: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  mainCost: {
    'deepseek-flash': {
      peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      idle: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  },
  subagentCost: [{
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    buckets: {
      peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      idle: { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 },
    },
  }],
})

assert.deepEqual(lines, [
  'idle',
  'deepseek-official/deepseek-flash',
  '/workspace',
  'Context: 50 tokens / 100 tokens (50%)',
  'Tokens: input 1m · output 0 · cache read 0 · cache write 0',
  'Estimated session cost: ¥5.0000',
])

const unknownContext = formatStatusLines({
  status: 'idle',
  provider: 'deepseek-official',
  model: 'deepseek-flash',
  cwd: '/workspace',
  contextWindow: undefined,
  contextOccupancy: { usedTokens: 50, contextWindow: undefined, source: 'sample' },
  tokens: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    idle: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  mainCost: {},
  subagentCost: [],
})
assert.equal(unknownContext[3], 'Context: 50 tokens (window capacity unknown)')
assert.equal(unknownContext[5], 'Estimated session cost: unavailable (no usage recorded)')

const unknownPrice = formatStatusLines({
  status: 'idle',
  provider: 'custom-provider',
  model: 'custom-model',
  cwd: '/workspace',
  contextWindow: undefined,
  contextOccupancy: undefined,
  tokens: {
    input: 10,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    peak: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 },
    idle: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  mainCost: {
    'custom-model': {
      peak: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 },
      idle: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  },
  subagentCost: [],
})
assert.equal(unknownPrice[3], 'Context: unavailable')
assert.equal(unknownPrice[5], 'Estimated session cost: unavailable (10 tokens could not be priced with official rates)')

console.log('Status summary passed: occupancy, cumulative token usage, main and subagent cost, and unavailable data')
