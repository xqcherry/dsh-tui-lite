#!/usr/bin/env node
/** Pi-style completion through the real input parser, renderer and xterm buffer. */
import './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import React from 'react'
import xtermHeadless from '@xterm/headless'
import { Box, Text, render } from '../lib/types/ui/primitives.js'
import { PromptInput } from '../lib/types/modules/composer/ui/PromptInput.js'
import { createComposerModule } from '../lib/types/modules/composer/model/module.js'
import { createPublication } from '../lib/types/shared/state/module-store.js'
import { completeCommands, completeTuiCommands, LOCAL_COMMANDS } from '../lib/types/shared/commands.js'
import { composerFixture } from './lib/module-fixtures.mjs'
import instances from '../lib/types/ink/instances.js'
import { settled, viewportLines } from './lib/term-test.mjs'

const { Terminal } = xtermHeadless
const UP = '\x1b[A'
const DOWN = '\x1b[B'
const ESC = '\x1b'
const roots = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'model', 'models'].map(name => ({
  name, description: `DESC_${name}\nsecond line`,
}))

async function fixture(historyRows, cols = 40, rows = 16, alternate = false) {
  const term = new Terminal({ cols, rows, scrollback: 10000, allowProposedApi: true })
  let output = ''
  const stdout = new Writable({ write(chunk, _encoding, callback) { output += String(chunk); term.write(String(chunk), callback) } })
  Object.assign(stdout, { columns: cols, rows, isTTY: true })
  const stderr = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  const stdin = new PassThrough()
  Object.assign(stdin, { isTTY: true, setRawMode() {}, ref() {}, unref() {} })
  const composerOwner = createComposerModule({
    options: { model: 'fixture-model', provider: 'fixture', cwd: '/command-suggestions-fixture' },
    input: { agentId: 'fixture', sessionId: 'fixture-session', mode: { id: 'default', label: 'Default' }, cwdDescription: '/command-suggestions-fixture' },
  }, createPublication())
  const controller = React.createRef()
  const submitted = []
  const commands = []
  const listeners = new Set()
  let models = []
  let revision = 0
  const channel = {
    cwd: '/command-suggestions-fixture', agentId: 'fixture', agentBindingGeneration: 1,
    mode: { id: 'default', plan: false }, commandList: roots,
    notifications: [], pending: [], working: false,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    cycleMode() { throw new Error('Backtab must belong to candidates') },
    commandCompletions(input) { return completeTuiCommands(input, channel.commandList, path => path[0] === 'model' ? models : []) },
    submit(text) { submitted.push(text) }, steer(text) { submitted.push(text) },
    removePending() { return false }, listFileCandidates: async () => [], listFiles: async () => [],
    notify() {},
  }
  const publish = () => { channel.sessionTitle = `revision-${++revision}`; for (const listener of listeners) listener() }
  const markers = Array.from({ length: historyRows }, (_, index) => `HISTORY_${String(index).padStart(3, '0')}`)
  const makeTree = () => React.createElement(Box, { flexDirection: 'column', ...(alternate ? { height: rows } : {}) },
    React.createElement(Text, null, markers.join('\n')),
    React.createElement(PromptInput, {
      ...composerFixture(channel), composer: { ...composerFixture(channel).composer, store: composerOwner.store }, controllerRef: controller, helpOpen: false, onToggleHelp() {}, selectionActive: false,
      onRunCommand(name, raw) { commands.push([name, raw]); return true },
    }),
  )
  const app = await render(makeTree(), { stdout, stderr, stdin, exitOnCtrlC: false, patchConsole: false })
  if (alternate) {
    stdout.write('\x1b[?1049h')
    instances.get(stdout).setAltScreenActive(true, true)
    app.rerender(makeTree())
  }
  assert(await settled(() => controller.current !== null), 'composer mounted')
  const lines = () => viewportLines(term)
  const allLines = () => Array.from({ length: term.buffer.active.length }, (_, row) => term.buffer.active.getLine(row)?.translateToString(true) ?? '')
  const has = text => lines().some(line => line.includes(text))
  const send = async (text, predicate, label) => {
    stdin.write(text)
    assert(await settled(predicate), `${label}: ${JSON.stringify(lines())}`)
  }
  const clear = async () => { controller.current.clear(); assert(await settled(() => !has('→ ') && controller.current.text() === '')) }
  return { term, stdout, stdin, controller, channel, commands, submitted, lines, allLines, has, send, clear, publish,
    setModels(next) { models = next; composerOwner.ingress.invalidateCommandCompletions() },
    output: () => output,
    resize(cols, rows) { term.resize(cols, rows); Object.assign(stdout, { columns: cols, rows }); stdout.emit('resize') },
    markers,
    appendHistory(marker) { markers.push(marker); app.rerender(makeTree()) },
    async close() { await app.unmount(); composerOwner.dispose(); term.dispose() },
  }
}

const skillCommand = { name: 'brandkit', description: 'Brand design', skill: true }
assert.equal(LOCAL_COMMANDS.some(command => command.name === 'session'), false, '/session is not exposed as a local command')
const allCommands = [...LOCAL_COMMANDS, { name: 'plan', description: 'Plan mode', external: true }, skillCommand]
assert.deepEqual(completeTuiCommands('/', allCommands).map(item => item.commandLine), allCommands.map(item => `/${item.name}`), 'bare slash includes every local, plugin and skill command in catalog order')
const [skillCompletion] = completeCommands('/bra', [skillCommand])
assert.equal(skillCompletion.skill, true, 'completion preserves the skill marker')
assert.equal(skillCompletion.commandLine, '/brandkit')
assert.equal(skillCompletion.replacement, '/brandkit ')

const skillFixture = await fixture(0, 80, 16, true)
skillFixture.channel.commandList = [skillCommand, { name: 'brandkit-with-a-very-long-name', description: 'Long skill', skill: true }]
skillFixture.publish()
await skillFixture.send('/', () => skillFixture.has('→ skill: brandkit'), 'bare slash includes and labels skills')
assert(skillFixture.has('Brand design'), 'skill description remains visible when wide')
skillFixture.resize(40, 10)
assert(await settled(() => skillFixture.has('→ skill: brandkit') && !skillFixture.has('Brand design')), 'narrow terminal retains skill prefix')
await skillFixture.send(DOWN, () => skillFixture.has('→ skill: brandkit-with-'), 'long skill name is truncated after prefix')
assert(!skillFixture.has('brandkit-with-a-very-long-name'), 'long skill name stays within the name column')
await skillFixture.send(UP + '\t', () => skillFixture.controller.current.text() === '/brandkit ', 'skill completion inserts original invocation')
assert.equal(skillFixture.commands.length, 0, 'skill completion does not execute a command')
await skillFixture.close()

const f = await fixture(3, 80, 16, true)
await f.send('/', () => f.has('→ alpha') && f.has('(1/8)'), 'root candidates')
assert(f.lines().findIndex(line => line.includes('→ alpha')) > f.lines().findIndex(line => line.includes('/')), 'list below input')
assert(f.has('DESC_alpha second line'), 'wide descriptions are single-line')
await f.send(UP, () => f.has('→ models') && f.has('(8/8)'), 'up wraps and scrolls to last item')
await f.send(DOWN, () => f.has('→ alpha') && f.has('(1/8)'), 'down wraps')
await f.send('\x1b[Z', () => f.has('→ alpha'), 'Backtab stays in candidates')
await f.send(`${DOWN}${DOWN}\t`, () => f.controller.current.text() === '/charlie ', 'batched navigation and Tab use latest selection')
assert(await settled(() => !f.has('→ ')), 'Tab closes list')
await f.send('\x1a', () => f.controller.current.text() === '/', 'undo entire completion')
await f.clear()
await f.send(`/mo${DOWN}\r`, () => f.commands.length === 1, 'batched root acceptance submits')
assert.equal(f.commands[0][0], 'models')
await f.clear()
f.channel.working = true
f.publish()
await f.send('/mo\t', () => f.controller.current.text() === '/model ', 'working Tab completes before queueing')
assert.equal(f.submitted.length, 0)
await f.clear()
f.channel.working = false
f.publish()
await f.send('/model ', () => f.controller.current.text() === '/model ', 'cold parameter query')
f.setModels([{ name: 'provider/model-one', description: 'model one' }, { name: 'provider/model-two', description: 'model two' }])
assert(await settled(() => f.has('→ model provider/model-one')), 'catalog publication refreshes unchanged input')
await f.send(DOWN + '\r', () => f.controller.current.text() === '/model provider/model-two ', 'parameter Enter fills without execution')
assert.equal(f.commands.length, 1)
await f.clear()
await f.send('/mo', () => f.has('→ model'), 'dismissal setup')
await f.send(ESC, () => !f.has('→ '), 'Esc dismisses')
assert.equal(f.controller.current.text(), '/mo')
await f.send('d', () => f.has('→ model'), 'editing reopens')
await f.clear()
await f.send('/', () => f.has('→ alpha'), 'mouse setup')
let row = f.lines().findIndex(line => line.includes('bravo'))
// SGR mouse coordinates are one-based. Press/release must use the same row.
await f.send(`\x1b[<0;3;${row + 1}M\x1b[<0;3;${row + 1}m`, () => f.controller.current.text() === '/bravo ', 'mouse click fills without submission')
assert.equal(f.commands.length, 1)
await f.clear()
await f.send('/', () => f.has('→ alpha'), 'wheel setup')
row = f.lines().findIndex(line => line.includes('→ alpha'))
await f.send(`\x1b[<65;3;${row + 1}M`, () => f.has('→ bravo'), 'wheel moves selection')
f.resize(40, 10)
assert(await settled(() => f.has('→ bravo') && !f.has('DESC_')), 'narrow short terminal hides description and keeps selection')
await f.clear()
f.resize(12, 8)
await f.send('/model provider/', () => f.controller.current.text() === '/model provider/' && !f.has('→ '), 'wrapped draft leaves no candidate room')
f.stdin.write('\t')
await new Promise(resolve => setTimeout(resolve, 150)) // 固定窗:探针 — hidden completion must not accept Tab.
assert.equal(f.controller.current.text(), '/model provider/', 'wrapped hidden candidates do not own Tab')
await f.clear()
f.resize(40, 10)
f.channel.commandList = [{ name: 'models-extra', description: 'longer command' }, ...roots]
f.publish()
await f.send('/models', () => f.lines().some(line => line.trim() === '→ models'), 'exact command wins over earlier longer prefix')
await f.clear()
await f.send('/unknown-command', () => f.controller.current.text() === '/unknown-command', 'unmatched command remains editable')
assert(await settled(() => !f.has('→ ')), 'no candidates for unmatched command')
await f.clear()
f.resize(20, 8)
await f.send('/', () => f.has('→ models-extra'), 'very short terminal keeps one candidate visible')
assert(!f.has('(1/9)'), 'counter yields to candidate in a one-row budget')
f.resize(20, 6)
assert(await settled(() => !f.has('→ ')), 'terminal with no room hides candidates')
await f.send('\t', () => f.controller.current.text() === '/', 'hidden candidates cannot accept Tab')
await f.clear()
await f.close()
console.log('PASS: completion keys, batched input, catalog refresh, mouse, resize')

// Exercise growth/shrink around the viewport boundary and with long history.
for (const historyRows of [2, 9, 12, 25]) {
  const t = await fixture(historyRows)
  const startOutput = t.output().length
  for (let iteration = 0; iteration < 50; iteration++) {
    await t.send('/', () => t.has('→ alpha') && t.has('(1/8)'), 'grow to six rows')
    await t.send('m', () => t.has('→ model') && !t.has('(1/8)'), 'shrink to two rows')
    await t.send(ESC, () => !t.has('→ '), 'shrink to zero rows')
    await t.clear()
  }
  t.appendHistory('STREAMED_AFTER_CYCLES')
  assert(await settled(() => t.has('STREAMED_AFTER_CYCLES')), 'streaming continues after dynamic-height cycles')
  await t.send('/', () => t.has('→ alpha'), 'reopen while streaming')
  t.appendHistory('STREAMED_WITH_CANDIDATES')
  assert(await settled(() => t.has('STREAMED_WITH_CANDIDATES')), 'transcript grows while candidates are visible')
  await t.send(ESC, () => !t.has('→ '), 'close after streaming')
  await t.clear()
  const buffer = t.allLines()
  for (const marker of t.markers) {
    assert.equal(buffer.filter(line => line.includes(marker)).length, 1, `history ${historyRows}: ${marker} occurs exactly once in viewport + scrollback`)
  }
  assert(!buffer.some(line => /→ |\(\d+\/8\)/.test(line)), 'no candidate residue in scrollback')
  assert(!t.output().slice(startOutput).includes('\x1b[3J'), 'candidate changes never erase scrollback')
  await t.send('after cycles', () => t.has('after cycles'), 'input still paints at the correct row')
  await t.close()
  console.log(`PASS: ${historyRows} history rows, 50 dynamic-height cycles, full scrollback unique`)
}
console.log('All command-suggestions checks passed')
