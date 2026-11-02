#!/usr/bin/env node
/** Right rail stays aligned with the corners through wrapping and resizing. */
import './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import React from 'react'
import xtermHeadless from '@xterm/headless'
import { Box, render } from '../lib/types/ui/primitives.js'
import instances from '../lib/types/ink/instances.js'
import { PromptInput } from '../lib/types/modules/composer/ui/PromptInput.js'
import { composerFixture } from './lib/module-fixtures.mjs'
import { settled, viewportLines } from './lib/term-test.mjs'

const { Terminal } = xtermHeadless

async function checkPrompt(homeButton, plan, alternate = false) {
  const term = new Terminal({ cols: 40, rows: 24, allowProposedApi: true })
  const stdout = new Writable({ write(chunk, _encoding, callback) { term.write(String(chunk), callback) } })
  Object.assign(stdout, { columns: 40, rows: 24, isTTY: true })
  const stdin = new PassThrough()
  Object.assign(stdin, { isTTY: true, setRawMode() {}, ref() {}, unref() {} })
  const stderr = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  const controller = React.createRef()
  const submitted = []
  const channel = {
    mode: { id: plan ? 'plan' : 'default', plan },
    sessionTitle: '中文 session', promptSessionLabel: true,
    reasoningEffort: 'high', effortLevels: ['low', 'high'],
    commandList: [], notifications: [], pending: [], working: false,
    notify() {}, submit(text) { submitted.push(text) }, steer() {},
    removePending() { return false }, listFiles: async () => [],
  }
  const tree = React.createElement(Box, { flexDirection: 'column', ...(alternate ? { height: 24 } : {}) }, React.createElement(PromptInput, {
    ...composerFixture(channel), controllerRef: controller,
    onOpenHelp() {}, onRunCommand() { return false },
    selectionActive: false, ...(homeButton ? { onOpenSessions() {} } : {}),
  }))
  const app = await render(tree, { stdout, stdin, stderr, patchConsole: false, exitOnCtrlC: false })
  if (alternate) {
    stdout.write('\x1b[?1049h')
    instances.get(stdout).setAltScreenActive(true, true)
    app.rerender(tree)
  }
  const frame = () => {
    const lines = viewportLines(term)
    const top = lines.findIndex(line => line.startsWith('╭'))
    const bottom = lines.findIndex((line, index) => index > top && line.startsWith('╰'))
    return { top, bottom, lines, body: lines.slice(top + 1, bottom) }
  }
  async function expectFrame(label, bodyRows) {
    assert(await settled(() => {
      const { top, bottom, body } = frame()
      if (top < 0 || bottom < 0 || body.length !== bodyRows) return false
      const buffer = term.buffer.active
      const cell = row => buffer.getLine(buffer.baseY + row)?.getCell(term.cols - 1)?.getChars()
      return cell(top) === '╮' && cell(bottom) === '╯'
        && body.every((_line, index) => cell(top + 1 + index) === '│')
    }), `${label}: ${JSON.stringify(frame().lines)}`)
  }
  try {
    await expectFrame('empty input has a connected right border', 1)
    assert(frame().body[0].includes('❯'), 'left prompt remains visible')
    assert(frame().lines[frame().top].includes('中文 session'), 'session label remains visible')
    const width = homeButton ? 34 : 36
    const text = 'a'.repeat(width + 1)
    controller.current.append(text)
    await expectFrame('text wraps before the right rail', 2)
    assert.equal(frame().body.map(line => line.replace(/[^a]/g, '')).join(''), text)
    assert(await settled(() => term.buffer.active.cursorX === (homeButton ? 5 : 3)), 'caret follows the wrapped text')
    stdin.write('\x1b[D')
    assert(await settled(() => term.buffer.active.cursorX === 38), 'left arrow moves to the preceding row end inside the rail')
    stdin.write('X')
    assert(await settled(() => controller.current.text() === `${text.slice(0, -1)}Xa`), 'typing inserts at the moved caret')
    stdin.write('\r')
    assert(await settled(() => submitted.length === 1), 'editing and submission work at wrap boundary')
    assert.equal(submitted[0], `${text.slice(0, -1)}Xa`)
    await expectFrame('submission restores the empty frame', 1)
    // Unicode-6 xterm needs the renderer's existing compensation for modern emoji.
    controller.current.append('甲🫠\n\n乙')
    await expectFrame('wide characters and blank lines retain the rail', 3)
    assert(frame().body[0].includes('甲🫠') && frame().body[2].includes('乙'))
    if (alternate) {
      term.resize(80, 24)
      stdout.columns = 80
      stdout.emit('resize')
      await expectFrame('fullscreen resize preserves the rail beside wide characters', 3)
      term.resize(40, 24)
      stdout.columns = 40
      stdout.emit('resize')
      await expectFrame('fullscreen shrink preserves the rail beside wide characters', 3)
    }
    controller.current.clear()
    await expectFrame('clear restores one row', 1)
    if (alternate) {
      controller.current.append('abc')
      const prefix = homeButton ? 4 : 2
      assert(await settled(() => term.buffer.active.cursorX === prefix + 3), 'caret follows the short draft')
      const mouseRow = frame().top + 2
      stdin.write(`\x1b[<0;${prefix + 2};${mouseRow}M\x1b[<0;${prefix + 2};${mouseRow}m`)
      assert(await settled(() => term.buffer.active.cursorX === prefix + 1), 'click positions the caret inside the input')
      stdin.write('Z')
      assert(await settled(() => controller.current.text() === 'aZbc'), 'typing follows the clicked caret')
      controller.current.clear()
      await expectFrame('clear after mouse editing restores one row', 1)
    }
    term.resize(80, 24)
    stdout.columns = 80
    stdout.emit('resize')
    await expectFrame('rail follows terminal resize', 1)
    controller.current.append('a'.repeat(100))
    await expectFrame('wide terminal wraps without clipping the rail', 2)
    term.resize(40, 24)
    stdout.columns = 40
    stdout.emit('resize')
    await expectFrame('narrow terminal reflows all rows', 3)
    console.log(`PASS: right border, 40/80 columns, home=${homeButton}, plan=${plan}, alternate=${alternate}`)
  } finally {
    await app.unmount()
    term.dispose()
  }
}

for (const homeButton of [false, true]) {
  for (const plan of [false, true]) await checkPrompt(homeButton, plan)
}
await checkPrompt(true, true, true)
