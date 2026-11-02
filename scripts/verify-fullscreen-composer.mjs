#!/usr/bin/env node
/**
 * Fullscreen composer pinning: the fixed-height layout must keep the prompt
 * on the same terminal rows while the transcript grows, shrinks, streams,
 * scrolls, opens overlays and resizes.
 *
 * Run: node --import tsx/esm scripts/verify-fullscreen-composer.mjs
 */
import './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import React from 'react'
import xtermHeadless from '@xterm/headless'
import { fixtureModules } from './lib/module-fixtures.mjs'
import { Chat } from '../src/modules/workbench/ui/Chat.js'
import { AlternateScreen } from '../src/ink/components/AlternateScreen.js'
import { QuestionStore } from '../src/modules/decisions/model/questions.js'
import { render } from '../src/ui/primitives.js'

const { Terminal } = xtermHeadless
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function settled(predicate, label, timeout = 3000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (predicate()) return
    await sleep(20)
  }
  assert.fail(`${label}: condition was not met in ${timeout}ms`)
}

async function fixture(columns = 80, rows = 24) {
  const term = new Terminal({ cols: columns, rows, scrollback: 500, allowProposedApi: true })
  const stdin = new PassThrough()
  Object.assign(stdin, { isTTY: true, setRawMode() { return stdin }, ref() { return stdin }, unref() { return stdin } })
  const stdout = new Writable({ write(chunk, _encoding, callback) { term.write(String(chunk), callback) } })
  Object.assign(stdout, { columns, rows, isTTY: true })
  const stderr = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  stderr.isTTY = true

  const listeners = new Set()
  const approvalListeners = new Set()
  const notices = []
  let approval = null
  const channel = {
    version: 0,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    emit() { channel.version++; for (const listener of listeners) listener() },
    agentId: 'fullscreen-test',
    agentBindingGeneration: 0,
    rows: [],
    pending: [],
    notifications: [],
    cwd: '/fullscreen-test',
    displayCwd: '/fullscreen-test',
    model: 'fixture-model',
    provider: 'fixture',
    status: 'idle',
    working: false,
    mode: { id: 'default', plan: false },
    modeIndex: 0,
    commandList: [
      { name: 'help', description: 'Help' },
      { name: 'model', description: 'Model' },
    ],
    commandCompletions() {
      return [{ name: 'model', description: 'Model', replacement: 'model', commandLine: '/model' }]
    },
    notify(text) { notices.push(text) },
    submit() {},
    steer() {},
    cancel() {},
    stagedImageGeneration() { return 0 },
    hasStagedImage() { return false },
    discardStagedImage() {},
  }
  const questionStore = new QuestionStore()
  const approvalStore = {
    subscribe(listener) { approvalListeners.add(listener); return () => approvalListeners.delete(listener) },
    getSnapshot() { return approval },
    decide() { approval = null; for (const listener of approvalListeners) listener() },
  }
  const tree = React.createElement(
    AlternateScreen,
    null,
    React.createElement(Chat, {
      ports: fixtureModules(channel),
      questionStore,
      approvalStore,
      modelConfigured: async () => true,
      fullscreen: true,
      onExit() {},
    }),
  )
  const app = await render(tree, { stdout, stderr, stdin, exitOnCtrlC: false, patchConsole: false })
  await settled(() => term.buffer.active.type === 'alternate', 'alternate screen entered')

  const lines = () => {
    const buffer = term.buffer.active
    return Array.from({ length: term.rows }, (_, row) =>
      buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '',
    )
  }
  const promptTop = () => {
    const line = lines().findIndex(text => text.startsWith('❯'))
    return line < 0 ? -1 : line - 1
  }
  const viewportText = () => lines().join('\n')

  return {
    term, stdin, stdout, channel, notices, approvalStore, lines, promptTop, viewportText,
    async push(count, text = index => `message ${index}`) {
      const start = channel.rows.length
      for (let index = start; index < start + count; index++) {
        channel.rows.push({ kind: 'assistant', id: index + 1, text: text(index), streaming: false })
      }
      channel.emit()
      await sleep(120)
    },
    async mutate(index, patch) {
      Object.assign(channel.rows[index], patch)
      channel.emit()
      await sleep(120)
    },
    showApproval() {
      approval = { key: 'approval-test', toolName: 'shell', agentId: channel.agentId, command: 'echo test' }
      for (const listener of approvalListeners) listener()
    },
    async resize(nextColumns, nextRows) {
      stdout.columns = nextColumns
      stdout.rows = nextRows
      term.resize(nextColumns, nextRows)
      stdout.emit('resize')
      await sleep(200)
    },
    async unmount() {
      app.unmount()
      await sleep(50)
    },
    async close() {
      app.unmount()
      await sleep(50)
      term.dispose()
    },
  }
}

const f = await fixture()
try {
  assert.equal(f.promptTop(), 19, 'fresh 80x24 terminal keeps the prompt at rows-5')

  await f.push(12)
  assert.equal(f.promptTop(), 19, 'prompt stays pinned after messages arrive')

  await f.mutate(11, { streaming: true, text: 'streaming\nwith\nmore\nlines' })
  assert.equal(f.promptTop(), 19, 'prompt stays pinned while a row streams')

  await f.mutate(11, { text: 'streaming\nwith\nmore\nlines\nand\nmore\nand\nmore' })
  assert.equal(f.promptTop(), 19, 'prompt stays pinned as streaming text grows')

  await f.mutate(11, { streaming: false, text: 'settled' })
  assert.equal(f.promptTop(), 19, 'prompt stays pinned when the streamed row settles shorter')

  await f.push(78)
  assert.equal(f.promptTop(), 19, 'prompt stays pinned in a long transcript')

  // Manual scroll: wheel up over the transcript, then back down. The prompt
  // is outside the ScrollBox and must not move.
  const beforeWheel = f.viewportText()
  for (let index = 0; index < 6; index++) f.stdin.write('\x1b[<64;10;10M')
  await sleep(250)
  assert.equal(f.promptTop(), 19, 'prompt stays pinned while scrolling up')
  assert.notEqual(f.viewportText(), beforeWheel, 'wheel-up scrolls the transcript')
  for (let index = 0; index < 20; index++) f.stdin.write('\x1b[<65;10;10M')
  await sleep(250)
  assert.equal(f.promptTop(), 19, 'prompt stays pinned while scrolling down')

  // PageUp is wired to the same scroll viewport.
  const beforePage = f.viewportText()
  f.stdin.write('\x1b[5~')
  await sleep(250)
  assert.equal(f.promptTop(), 19, 'prompt stays pinned on PageUp')
  assert.notEqual(f.viewportText(), beforePage, 'PageUp scrolls the transcript')

  // Command suggestions are an overlay above the prompt: opening them must
  // not consume layout rows.
  f.stdin.write('/')
  await settled(() => f.viewportText().includes('→ model'), 'command suggestions opened')
  assert.equal(f.promptTop(), 19, 'prompt stays pinned while suggestions are open')
  // The suggestion test leaves `/` in the draft; complete it to `/help`.
  f.stdin.write('help\r')
  await settled(() => f.promptTop() === -1 && f.viewportText().includes('/help'), 'command menu opened')
  assert.equal(f.lines()[f.term.rows - 1].trim(), '? for shortcuts', 'hint stays on the bottom row while a menu is open')
  f.stdin.write('\x1b')
  await settled(() => f.promptTop() === 19, 'command menu closed')

  // An approval replaces the prompt in the bottom slot; the status/hint rows
  // stay at the terminal bottom.
  f.showApproval()
  await settled(() => f.viewportText().includes('Awaiting approval'), 'approval panel opened')
  const approvalLines = f.lines()
  assert.equal(approvalLines[f.term.rows - 1].trim(), '? for shortcuts', 'hint stays on the bottom row')
  assert(approvalLines[f.term.rows - 2].includes('default'), 'status stays on the row above the hint')
  f.approvalStore.decide('allowed-once')
  await settled(() => f.promptTop() === 19, 'prompt returns after approval')

  // Resize keeps the fixed bottom slot attached to the new height.
  await f.resize(40, 15)
  assert.equal(f.promptTop(), 10, 'prompt stays at rows-5 after resize to 40x15')
  await f.resize(100, 30)
  assert.equal(f.promptTop(), 25, 'prompt stays at rows-5 after resize to 100x30')

  console.log('PASS: fullscreen composer stays pinned through growth, shrink, scroll, overlays and resize')
} finally {
  await f.close()
}

// The alternate screen must be left behind on unmount.
const after = await fixture(80, 24)
try {
  assert.equal(after.term.buffer.active.type, 'alternate', 'fixture starts on the alternate screen')
  await after.unmount()
  assert.equal(after.term.buffer.active.type, 'normal', 'unmount returns to the main screen')
} finally {
  after.term.dispose()
}
console.log('PASS: fullscreen unmount leaves the alternate screen')
