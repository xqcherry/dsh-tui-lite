/** Source regression: configuration checks never make a model request. */
import assert from 'node:assert/strict'
import { isModelConfigured, type ModelConfigurationHost } from '../src/dsh-adapter/model-configuration.js'
const base: ModelConfigurationHost = {
  llm: { listModels: async () => [{ id: 'test' }], listConfigurableProviders: () => [] },
}
assert.equal(await isModelConfigured(base, 'deepseek-official', 'test'), false)
assert.equal(await isModelConfigured({ ...base, credentials: { resolve: async ref => ref === 'DEEPSEEK_API_KEY' ? 'secret' : undefined } }, 'deepseek-official', 'test'), true)
assert.equal(await isModelConfigured({ ...base, llm: { listModels: async () => [], listConfigurableProviders: () => [] } }, 'local', 'test'), false)
const configurable = {
  ...base,
  llm: { ...base.llm!, listConfigurableProviders: () => [{ provider: 'custom', settingsNs: 'models', settingsPath: ['routes', 'custom'] }] },
  settings: { describe: () => [{ ns: 'models', value: { routes: { custom: { apiKeyEnv: 'CUSTOM_KEY' } } } }] },
}
assert.equal(await isModelConfigured(configurable, 'custom', 'test'), false)
assert.equal(await isModelConfigured({ ...configurable, credentials: { resolve: async () => 'secret' } }, 'custom', 'test'), true)
assert.equal(await isModelConfigured({ ...configurable, settings: { describe: () => [{ ns: 'models', value: { routes: { custom: { baseURL: 'http://localhost' } } } }] } }, 'custom', 'test'), true)
assert.equal(await isModelConfigured({ ...base, auth: { providers: async () => [{ provider: 'account', signedIn: true }] } }, 'account', 'test'), true)
assert.equal(await isModelConfigured({ ...base, auth: { providers: async () => [{ provider: 'account', signedIn: false }] } }, 'account', 'test'), false)
console.log('Model configuration checks passed')
