#!/usr/bin/env node
/** Compact branding, real terminal layout, scrolling and animation lifetime. */
import './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import React from 'react'
import chalk from 'chalk'
import xtermHeadless from '@xterm/headless'
import { getWhalePixels } from '../lib/types/modules/workbench/ui/whale-frames.js'
import { ProductHeader } from '../lib/types/modules/workbench/ui/ProductHeader.js'
import { Chat } from '../lib/types/modules/workbench/ui/Chat.js'
import { ClockContext } from '../lib/types/ink/components/ClockContext.js'
import { Box, Text, render } from '../lib/types/ui/primitives.js'
import { createPublication } from '../lib/types/shared/state/module-store.js'
import { createWorkbenchModule } from '../lib/types/modules/workbench/model/module.js'
import { readHarnessVersion } from '../lib/types/dsh-adapter/contract.js'
import { QuestionStore } from '../lib/types/modules/decisions/model/questions.js'
import { fixtureModules } from './lib/module-fixtures.mjs'
import { settled, viewportLines } from './lib/term-test.mjs'

// The test process has piped stdout; emulate the truecolor TTY under test.
chalk.level = 3

const standard = getWhalePixels(0)
for (let time = 0; time <= 22000; time += 100) {
  const pixels = getWhalePixels(time)
  assert.equal(pixels.length, 8)
  assert(pixels.every(row => row.length === 12 && /^[0-4]+$/.test(row)))
}
assert.notDeepEqual(getWhalePixels(4800), standard, 'blink visibly closes the eye')
assert.deepEqual(getWhalePixels(5100), standard, 'eye opens again')
assert.notDeepEqual(getWhalePixels(10400), standard, 'tail visibly changes pose')
assert.deepEqual(getWhalePixels(11000), standard, 'tail returns to rest')
assert.deepEqual(getWhalePixels(0), standard, 'animation does not mutate resting pixels')

const manifest = JSON.parse(readFileSync(new URL('../node_modules/@deepseek-ai/dsh/package.json', import.meta.url)))
assert.equal(readHarnessVersion(), manifest.version, 'version comes from the installed Harness')
const publication = createPublication()
const workbench = createWorkbenchModule({ options: { backendVersion: manifest.version }, input: {} }, publication)
assert.equal(workbench.store.getSnapshot().backendVersion, manifest.version)
workbench.dispose()
publication.dispose()

const { Terminal } = xtermHeadless
async function fixture(cols) {
  const term = new Terminal({ cols, rows: 24, scrollback: 1000, allowProposedApi: true })
  const stdout = new Writable({ write(chunk, _encoding, callback) { term.write(String(chunk), callback) } })
  Object.assign(stdout, { columns: cols, rows: 24, isTTY: true })
  const stdin = new PassThrough()
  Object.assign(stdin, { isTTY: true, setRawMode() {}, ref() {}, unref() {} })
  const stderr = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  let now = 0
  const listeners = new Set()
  const clock = {
    now: () => now,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    setTickInterval() {}, suspend() {},
  }
  const header = props => React.createElement(ProductHeader, { model: 'deepseek-flash', cwd: '/workspace/项目/a-very-long-directory', backendVersion: manifest.version, ...props })
  const tree = (props, count = 0) => React.createElement(ClockContext.Provider, { value: clock },
    React.createElement(Box, { flexDirection: 'column' }, header(props),
      ...Array.from({ length: count }, (_, i) => React.createElement(Text, { key: i }, `message ${i}`))))
  const app = await render(tree(), { stdout, stdin, stderr, patchConsole: false, exitOnCtrlC: false })
  const screen = () => viewportLines(term)
  const colors = () => Array.from({ length: term.rows }, (_, y) =>
    Array.from({ length: term.cols }, (_, x) => {
      const cell = term.buffer.active.getLine(term.buffer.active.baseY + y)?.getCell(x)
      return `${cell?.getChars()}:${cell?.getFgColor()}:${cell?.getBgColor()}`
    }).join('|')).join('\n')
  const tick = time => { now = time; for (const listener of [...listeners]) listener() }
  const close = () => { app.unmount(); app.cleanup(); stdin.destroy(); term.dispose() }
  return { term, stdout, app, screen, colors, tree, tick, listeners, close }
}

for (const cols of [28, 40, 60, 80]) {
  const f = await fixture(cols)
  try {
    assert(await settled(() => f.screen().join('\n').includes(`DSH v${manifest.version}`)), `${cols} columns: brand and version fit`)
    assert(f.screen().some(line => line.includes('deepseek-flash')), 'model shown on its own line')
    assert(f.screen().some(line => line.includes('/workspace/')), 'directory is shown')
    const brandRow = f.screen().findIndex(line => line.includes('DSH'))
    assert.equal(brandRow, cols < 40 ? 4 : 1, 'compact text starts beside the visible whale head')
    if (cols >= 40) {
      const headRow = f.screen().findIndex(line => /[▀▄]/.test(line.slice(0, 12)))
      assert.equal(brandRow, headRow, 'brand aligns with the whale head instead of its empty top row')
    }
    const modelRow = f.screen().findIndex(line => line.includes('deepseek-flash'))
    const directoryRow = f.screen().findIndex(line => line.includes('/workspace/'))
    assert.equal(modelRow - brandRow, 1, 'title and model use compact consecutive lines')
    assert.equal(directoryRow - modelRow, 1, 'model and directory use compact consecutive lines')
    if (cols >= 60) {
      f.app.rerender(f.tree({ provider: 'deepseek-official', contextWindow: 1000000 }))
      assert(await settled(() => f.screen().some(line => line.includes('deepseek-flash[1m] · deepseek-official'))), 'model details show capacity and provider')
      f.app.rerender(f.tree({ provider: 'deepseek-official' }))
      assert(await settled(() => f.screen().some(line => line.includes('deepseek-flash · deepseek-official'))), 'unknown capacity is omitted')
      f.app.rerender(f.tree())
      assert(await settled(() => !f.screen().join('\n').includes('deepseek-official')), 'changing metadata removes stale details')
    }
    assert(await settled(() => f.listeners.size === 1), 'visible whale subscribes to the clock')
    const before = f.colors()
    f.tick(4800)
    assert(await settled(() => f.colors() !== before), 'blink changes terminal cell colors')
    assert.equal(f.screen().findIndex(line => line.includes('DSH')), brandRow, 'animation preserves geometry')
    f.app.rerender(f.tree({ model: 'new-model', cwd: '/new/cwd' }))
    assert(await settled(() => f.screen().join('\n').includes('new-model') && f.screen().join('\n').includes('/new/cwd')), 'model and directory update')
    f.app.rerender(f.tree({ backendVersion: undefined }))
    assert(await settled(() => !f.screen().join('\n').includes(`v${manifest.version}`)), 'missing version is omitted')
    f.app.rerender(f.tree({}, 45))
    assert(await settled(() => f.screen().join('\n').includes('message 44')), 'messages push branding into scrollback')
    f.tick(4900)
    f.tick(5100)
    assert(await settled(() => f.listeners.size === 0), 'offscreen whale stops subscribing')
    assert(!f.screen().some(line => line.includes('DSH')), 'header is not pinned')
    const history = Array.from({ length: f.term.buffer.active.length }, (_, i) => f.term.buffer.active.getLine(i)?.translateToString(true)).join('\n')
    assert.equal(history.match(/DSH v/g)?.length, 1, 'header leaves one copy in scrollback')
  } finally { f.close() }
}

// Exercise the actual Chat placement with a restored transcript and live stores.
const f = await fixture(40)
try {
  const listeners = new Set()
  const channel = {
    version: 0, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    rows: [{ id: 1, kind: 'user', text: 'restored message' }],
    pending: [], notifications: [], commandList: [], cwd: '/real/cwd', displayCwd: '/display/cwd',
    agentId: 'test', agentBindingGeneration: 0, model: 'real-model', provider: 'test',
    mode: { id: 'default', plan: false }, working: false,
    commandCompletions: () => [], stagedImageGeneration: () => 0,
    hasStagedImage: () => false, discardStagedImage() {}, notify() {},
  }
  const ports = fixtureModules(channel)
  const rowsBefore = JSON.stringify(channel.rows)
  const chat = () => React.createElement(Chat, {
    ports, questionStore: new QuestionStore(),
    approvalStore: { subscribe: () => () => {}, getSnapshot: () => null }, onExit() {},
  })
  f.app.rerender(chat())
  assert(await settled(() => f.screen().join('\n').includes('restored message')), 'restored history renders')
  const lines = f.screen()
  assert(lines.findIndex(line => line.includes('DSH')) < lines.findIndex(line => line.includes('restored message')), 'brand precedes restored transcript')
  assert(lines.some(line => line.includes('/display/cwd')), 'header uses the display directory')
  assert.equal(JSON.stringify(channel.rows), rowsBefore, 'branding creates no transcript rows')
  const emit = () => { channel.version++; for (const listener of listeners) listener() }
  channel.cwd = join(homedir(), 'rep', '项目')
  channel.displayCwd = channel.cwd
  channel.model = 'm'
  emit()
  assert(await settled(() => f.screen().filter(line => line.includes('~/rep/项目')).length === 2), 'header and status abbreviate home paths in a narrow TTY')
  assert.equal(channel.cwd, join(homedir(), 'rep', '项目'), 'real workspace remains absolute')
  channel.rows = Array.from({ length: 45 }, (_, id) => ({ id, kind: 'user', text: `history ${id}` }))
  emit()
  assert(await settled(() => f.screen().join('\n').includes('history 44')), 'actual Chat scrolls with the header')
  assert(!f.screen().some(line => line.includes('DSH')), 'actual Chat does not pin the header')
  channel.rows = []
  channel.agentBindingGeneration++
  channel.model = 'switched-model'
  channel.displayCwd = '/switched/cwd'
  emit()
  assert(await settled(() => f.screen().join('\n').includes('DSH') && f.screen().join('\n').includes('switched-model')), `new session restores header: ${JSON.stringify(f.screen())}`)
  assert(f.screen().some(line => line.includes('/switched/cwd')), 'session switch updates directory')
  channel.rows = [{ id: 0, kind: 'user', text: 'long message\n'.repeat(40) }]
  emit()
  assert(await settled(() => f.screen().some(line => line.includes('long message'))), 'single tall message renders')
  assert(!f.screen().some(line => line.includes('DSH')), 'one long message also scrolls the header out')
  channel.rows = [{ id: 0, kind: 'notice', text: 'Session cleared' }]
  emit()
  assert(await settled(() => f.screen().some(line => line.includes('DSH'))), `clearing a single tall message restores branding: ${JSON.stringify(f.screen())}`)
} finally { f.close() }

console.log('Whale header: compact animation, Harness version, narrow TTY, scrolling and live metadata pass')
