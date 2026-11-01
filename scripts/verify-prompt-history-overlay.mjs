#!/usr/bin/env node
/**
 * Regression: a history walk must own ↑/↓ until it returns to the draft.
 *
 * Slash candidates live below the input; history walks retain keyboard ownership. History walks through commands must restore drafts.
 * Runs in a narrow TTY to catch leftover menu rows and layout artifacts.
 *
 * Run after build: `node scripts/verify-prompt-history-overlay.mjs`.
 */
import { composerFixture } from './lib/module-fixtures.mjs'
import './lib/fake-home.mjs'
import { PassThrough, Writable } from 'node:stream'
import React from 'react'
import xtermHeadless from '@xterm/headless'
import { Box, Text, render } from '../lib/types/ui/primitives.js'
import { PromptInput } from '../lib/types/modules/composer/ui/PromptInput.js'
import { settled, sleep, viewportLines } from './lib/term-test.mjs'

const { Terminal: XTerm } = xtermHeadless

let failed = 0
/** Print one pass/fail line and keep a running failure count. */
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failed += 1
}

/** Build the writable TTY streams used by the headless prompt harness. */
function makeStreams(term) {
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      if (term === undefined) {
        callback()
      } else {
        term.write(String(chunk), callback)
      }
    },
  })
  stdout.columns = 40
  stdout.rows = 16
  stdout.isTTY = true
  const stderr = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  stderr.isTTY = true
  const stdin = new PassThrough()
  stdin.isTTY = true
  stdin.setRawMode = () => stdin
  stdin.setEncoding = () => stdin
  stdin.ref = () => stdin
  stdin.unref = () => stdin
  return { stdout, stderr, stdin }
}

const submitted = []
const commands = []
const controllerRef = React.createRef()
const channel = {
  mode: { id: 'default', plan: false },
  modeIndex: 0,
  cycleMode() {},
  commandList: [
    { name: 'skills', description: 'List available skills' },
    { name: 'model', description: 'Show the active model' },
  ],
  commandCompletions(input) {
    if (!['/', '/mo', '/skills', '/model'].includes(input)) return []
    const name = input === '/' || input === '/mo' ? 'model' : input.slice(1)
    return [{ name, description: 'MENUPROBE', commandLine: `/${name}`, replacement: `/${name} ` }]
  },
  notifications: [],
  pending: [],
  working: false,
  notify() {},
  submit(text) { submitted.push(text) },
  steer() {},
  interruptAndDeliver() { return 0 },
  removePending() { return false },
  stageImage() {},
  listFiles: async () => [],
  listFileCandidates: async () => [{
    id: 'demo.ts', path: 'demo.ts', displayPath: 'demo.ts',
    name: 'demo.ts', kind: 'file', score: 1,
  }],
}

const term = new XTerm({ cols: 40, rows: 16, scrollback: 100, allowProposedApi: true })
const { stdout, stderr, stdin } = makeStreams(term)
await render(
  React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Text, null, 'TRANSCRIPT_ANCHOR\n' + 'history row\n'.repeat(6)),
    React.createElement(PromptInput, {
    ...composerFixture(channel),
    controllerRef,
    helpOpen: false,
    onToggleHelp() {},
    onRunCommand(name) { commands.push(name); return true },
    selectionActive: false,
  })),
  { stdout, stderr, stdin, exitOnCtrlC: false, patchConsole: false },
)

const UP = '\x1b[A'
const DOWN = '\x1b[B'
/** True when some viewport row contains the text (input echo assertion). */
const shows = (text) => viewportLines(term).some(line => line.includes(text))

// 首帧挂载 pacing：等 React 树完成首次渲染与输入监听挂接，无单一可观测条件。
await sleep(500)

// Candidates appear below the input and Escape dismisses without clearing it.
stdin.write('/')
check('bare slash displays a candidate below the input',
  await settled(() => shows('→ model')))
stdin.write('mo')
check('slash prefix displays the selected candidate',
  await settled(() => shows('/mo') && shows('→ model')))
stdin.write('\x1b')
check('Esc dismisses candidates and retains the slash draft',
  await settled(() => controllerRef.current.text() === '/mo' && !shows('→ model')))
stdin.write('\t')
check('explicit Tab reopens and accepts completion after Esc',
  await settled(() => controllerRef.current.text() === '/model '))
stdin.write('\x1a')
check('completion is one undo step',
  await settled(() => controllerRef.current.text() === '/mo'))
stdin.write('\r')
check('Enter accepts a root candidate and runs the existing command route',
  await settled(() => commands[0] === 'model') && submitted.length === 0,
  JSON.stringify({ submitted, commands }))
submitted.length = 0
commands.length = 0
await sleep(150) // 固定窗:墙钟 — wait for the Enter deduplication window.

// Seed the history: one plain message, then a complete slash command.
stdin.write('plain one')
await sleep(150)
stdin.write('\r')
await settled(() => submitted.length === 1, JSON.stringify({ submitted }))
await sleep(150)
stdin.write('/model')
await sleep(150)
stdin.write('\r')
await settled(() => commands.length === 1 && commands[0] === 'model', JSON.stringify({ commands }))
await sleep(150)

// Type a draft but do NOT submit it.
stdin.write('draft 草稿')
await sleep(200)
check('draft typed into the input', await settled(() => shows('draft 草稿')))

// ↑ recalls `/model` without opening a candidate menu.
stdin.write(UP)
check('up recalls the /model history entry', await settled(() => shows('/model')))

// ↓ must return to the draft after recalling `/model`.
stdin.write(DOWN)
check(
  'down past the newest entry restores the draft after recalling a slash command',
  await settled(() => shows('draft 草稿')),
)

// The walk also continues UP through slash commands: ↑↑ from the
// draft reaches `plain one` past `/model`.
stdin.write(UP)
await settled(() => shows('/model'))
stdin.write(UP)
check(
  'up continues through the slash-command entry to the older one',
  await settled(() => shows('plain one')),
)

// ↓↓ returns all the way to the draft, and Enter submits it — the draft
// was never lost.
stdin.write(DOWN)
await settled(() => shows('/model'))
stdin.write(DOWN)
await settled(() => shows('draft 草稿'))
await sleep(150)
stdin.write('\r')
check(
  'draft submits intact after the round trip',
  await settled(() => submitted.length === 2 && submitted[1] === 'draft 草稿'),
  JSON.stringify({ submitted, commands }),
)

// Complete commands keep their explicit command route during a running turn.
await sleep(100) // 固定窗:墙钟 — cross the physical-Enter deduplication window.
channel.working = true
stdin.write('/model')
await settled(() => controllerRef.current.text() === '/model')
stdin.write('\r')
check('complete command executes while a turn is running',
  await settled(() => commands.length === 2 && commands[1] === 'model'),
  JSON.stringify({ submitted, commands }))

// The shared card and file-completion keyboard path remain functional.
channel.working = false
stdin.write('@de')
check('file candidates still display above the input',
  await settled(() => shows('demo.ts')))
stdin.write('\t')
check('Tab still accepts file completion',
  await settled(() => controllerRef.current.text() === '@demo.ts '))
check('transcript anchor remains visible without duplicate rows',
  viewportLines(term).filter(line => line.includes('TRANSCRIPT_ANCHOR')).length === 1)

console.log(failed === 0 ? '\nAll prompt-history-overlay checks passed' : `\n${failed} check(s) FAILED`)
process.exit(failed === 0 ? 0 : 1)
