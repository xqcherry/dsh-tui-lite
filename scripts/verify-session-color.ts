/** Restored color command: admission, completion, durable writes and replay. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { validateStoredEvents } from '@deepseek-ai/dsh-session-persistence'
import { createChatCommands, type ChatMenuItem } from '../src/modules/workbench/model/chat-commands.js'
import { readSessionColorPref, writeSessionColorPref } from '../src/modules/sessions/index.js'
import { LOCAL_COMMANDS } from '../src/shared/commands.js'
import { createCommandCompletions } from '../src/dsh-adapter/channel/command-completions.js'
import { createSessionMetadataActions } from '../src/dsh-adapter/channel/session-metadata.js'
import { ensureLegacySessionEventTypes, snapshotLiveSessionEvents } from '../src/dsh-adapter/compat/index.js'
import { createDshTranslator } from '../src/dsh-adapter/backend/translate.js'
import { createRuntimeModulesFixture } from './lib/runtime-modules-fixture.js'

// A direct run must not disturb the developer's real /color default.
const previousColorPref = readSessionColorPref()
let menu: readonly ChatMenuItem[] = []
const writes: string[] = []
const notices: string[] = []
const runtime = createRuntimeModulesFixture({ commands: {
  sessions: { setSessionColor: color => { writes.push(color) } },
  workbench: { notify: text => { notices.push(text); return () => {} } },
} })
const commands = createChatCommands({
  ports: runtime, ask: async () => ({ answers: [] }),
  openMenu: (_title, items) => { menu = items },
  onExit() {}, openHelp() {}, toggleThinking() {}, configured: () => false,
  refreshConfiguration: async () => {},
})
try {
  assert(LOCAL_COMMANDS.some(command => command.name === 'color'), 'color must be admitted locally without a configured model')
  await commands.runCommand('color', '', [])
  assert.deepEqual(menu.map(item => item.label), ['default (current)', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'cyan'])
  assert.deepEqual(writes, [], 'opening/cancelling a picker must not write')
  await menu[5]!.run()
  assert.deepEqual(writes.splice(0), ['blue'])
  runtime.sessions.ingress.metadata({ type: 'session.color', color: 'blue' })
  await commands.runCommand('color', '', [])
  assert.equal(menu[5]!.label, 'blue (current)')
  await commands.runCommand('color', '  CYAN  ', [])
  await commands.runCommand('color', ' default ', [])
  assert.deepEqual(writes.splice(0), ['cyan', ''])
  for (const input of ['invalid', 'blue red', 'constructor']) await commands.runCommand('color', input, [])
  assert.deepEqual(writes, [])
  assert.equal(notices.length, 3)
  assert(notices.every(text => text.includes('/color') && text.includes('default') && text.includes('cyan')))
  const complete = createCommandCompletions({
    commands: () => LOCAL_COMMANDS, settings: () => ({}),
    permissionPresets: () => ({ options: [] }),
    model: { warmModelNodes() {}, modelNodes: () => [], warmEffortLevels() {} },
  })
  assert.equal(complete('/col')[0]?.commandLine, '/color')
  assert.equal(complete('/color bl')[0]?.commandLine, '/color blue')
  assert.equal(complete('/color def')[0]?.commandLine, '/color default')
  assert.equal(complete('/color ').length, 9)

  // The preference file is the fallback for sessions without their own event.
  const prefsDir = mkdtempSync(join(tmpdir(), 'dsh-tui-color-prefs-'))
  try {
    assert.equal(readSessionColorPref(prefsDir), undefined)
    assert.equal(writeSessionColorPref('cyan', prefsDir), true)
    assert.equal(readSessionColorPref(prefsDir), 'cyan')
    assert.equal(writeSessionColorPref('constructor', prefsDir), false, 'unknown colors must not be persisted')
    assert.equal(readSessionColorPref(prefsDir), 'cyan', 'a rejected write leaves the old value')
    assert.equal(writeSessionColorPref('', prefsDir), true)
    assert.equal(readSessionColorPref(prefsDir), undefined)
  } finally {
    rmSync(prefsDir, { recursive: true, force: true })
  }

  // A new module starts on the persisted default; reset restores it, and a
  // session's own durable event still wins.
  writeSessionColorPref('purple')
  const inherited = createRuntimeModulesFixture()
  try {
    assert.equal(inherited.sessions.store.getSnapshot().sessionColor, 'purple')
    inherited.sessions.ingress.resetSessionState()
    assert.equal(inherited.sessions.store.getSnapshot().sessionColor, 'purple')
    inherited.sessions.ingress.metadata({ type: 'session.color', color: 'pink' })
    assert.equal(inherited.sessions.store.getSnapshot().sessionColor, 'pink')
    inherited.sessions.ingress.resetSessionState()
    assert.equal(inherited.sessions.store.getSnapshot().sessionColor, 'purple')
  } finally {
    inherited.dispose()
  }

  // Use the real session append and strict persisted-event validator: picking a
  // color must never make the user's session impossible to resume.
  ensureLegacySessionEventTypes()
  const session = Session.create(SessionId('session-color-test'))
  let alive = true
  let bound = true
  const capture = { agent: { session } }
  const actions = createSessionMetadataActions({} as never, {
    owner: { current: () => alive, signal: new AbortController().signal },
    binding: { capture: () => capture, isCurrent: () => bound } as never,
    provider: () => 'fixture', model: () => 'fixture', emit() {},
    sessionTitle: () => '', setSessionTitle() {},
    skillRegistryFor: () => undefined, skillViewOptions: () => ({ scope: capture.agent as never, cwd: '/fixture' }),
  })
  actions.setSessionColor('red')
  assert.equal(readSessionColorPref(), 'red', 'the chosen color becomes the new-session default')
  actions.setSessionColor('blue')
  actions.setSessionColor('')
  assert.equal(readSessionColorPref(), undefined, 'default clears the new-session default')
  assert.deepEqual(snapshotLiveSessionEvents(session).map(event => [event.seq, event.type, event.data]), [
    [0, 'session/color', { color: 'red' }], [1, 'session/color', { color: 'blue' }], [2, 'session/color', { color: '' }],
  ])
  assert.throws(() => actions.setSessionColor('constructor'), /color/i)
  bound = false
  actions.setSessionColor('green')
  bound = true
  alive = false
  actions.setSessionColor('green')
  assert.equal(snapshotLiveSessionEvents(session).length, 3, 'stale or disposed bindings must not append')
  const events = validateStoredEvents(session.header, JSON.parse(JSON.stringify(snapshotLiveSessionEvents(session))))
  const restored = Session.create(session.id, events, session.header)
  const translator = createDshTranslator({} as never)
  const replayed: string[] = []
  for (const event of translator.translateReplay(snapshotLiveSessionEvents(restored))) {
    if (event.type === 'session.color') {
      runtime.sessions.ingress.metadata(event)
      replayed.push(runtime.sessions.store.getSnapshot().sessionColor)
    }
  }
  assert.deepEqual(replayed, ['red', 'blue', ''])
  assert.equal(runtime.sessions.store.getSnapshot().sessionColor, '')
  runtime.sessions.ingress.metadata({ type: 'session.color', color: 'pink' })
  runtime.sessions.ingress.resetSessionState()
  assert.equal(runtime.sessions.store.getSnapshot().sessionColor, '')
} finally {
  runtime.dispose()
  writeSessionColorPref(previousColorPref ?? '')
}
console.log('Session color passed: local command, picker, completion, new-session default, strict durable replay and binding fences')
