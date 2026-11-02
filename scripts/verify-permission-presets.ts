/** Permission preset metadata keeps useful descriptions without leaking undefined. */
import assert from 'node:assert/strict'
import { normalizePermissionPresetOption } from '../src/dsh-adapter/channel/permissions.js'
import { createCommandCompletions } from '../src/dsh-adapter/channel/command-completions.js'
import { LOCAL_COMMANDS } from '../src/shared/commands.js'

assert.deepEqual(normalizePermissionPresetOption({ value: 'read-only', name: 'Read-only' }), {
  value: 'read-only',
  name: 'Read-only',
  description: 'Read-only session: no file writes, no commands',
})
assert.deepEqual(normalizePermissionPresetOption({ value: 'workspace-write', name: 'Workspace write' }), {
  value: 'workspace-write',
  name: 'Workspace write',
  description: 'Read/write inside the workspace; writes need a prior read',
})
assert.deepEqual(normalizePermissionPresetOption({ value: 'danger-full-access', name: 'Full access' }), {
  value: 'danger-full-access',
  name: 'Full access',
  description: 'Unrestricted access, no approvals',
})
assert.deepEqual(normalizePermissionPresetOption({
  value: 'read-only', name: 'Read-only', description: 'Runtime supplied help',
}), {
  value: 'read-only',
  name: 'Read-only',
  description: 'Runtime supplied help',
})
assert.deepEqual(normalizePermissionPresetOption({ value: 'custom-preset', name: 'Custom preset' }), {
  value: 'custom-preset',
  name: 'Custom preset',
})

const completionOptions = [
  normalizePermissionPresetOption({ value: 'read-only', name: 'Read-only', description: 'Runtime supplied help' })!,
  normalizePermissionPresetOption({ value: 'workspace-write', name: 'Workspace write' })!,
  normalizePermissionPresetOption({ value: 'custom-preset', name: 'Custom preset' })!,
]
const complete = createCommandCompletions({
  commands: () => LOCAL_COMMANDS,
  settings: () => ({}),
  permissionPresets: () => ({ availability: 'runtime', options: completionOptions }),
  model: { warmModelNodes() {}, modelNodes: () => [], warmEffortLevels() {} },
})
const permissionSuggestions = complete('/permission ')
assert.equal(permissionSuggestions.find(option => option.commandLine === '/permission read-only')?.description, 'Runtime supplied help')
assert.equal(permissionSuggestions.find(option => option.commandLine === '/permission read-only')?.descriptionKey, undefined)
assert.equal(permissionSuggestions.find(option => option.commandLine === '/permission workspace-write')?.description, 'Read/write inside the workspace; writes need a prior read')
assert.equal(permissionSuggestions.find(option => option.commandLine === '/permission custom-preset')?.description, 'Custom preset')

console.log('Permission preset descriptions passed: menus, completions, built-in defaults, runtime descriptions and custom options')
