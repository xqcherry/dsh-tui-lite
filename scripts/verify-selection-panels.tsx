/** Closed blue frames and focus visibility through the real renderer/xterm. */
import './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import React from 'react'
import xtermHeadless from '@xterm/headless'
import { settled, viewportLines } from './lib/term-test.mjs'

process.env.FORCE_COLOR = '3'
const [{ render }, { CommandMenu }, { AskUserQuestionPanel }] = await Promise.all([
  import('../src/ui/primitives.js'),
  import('../src/modules/workbench/ui/CommandMenu.js'),
  import('../src/modules/decisions/ui/AskUserQuestionPanel.js'),
])
const { Terminal } = xtermHeadless
for (const columns of [80, 40, 20, 16]) {
  const rows = 24
  const term = new Terminal({ cols: columns, rows, allowProposedApi: true })
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} })
  const stdout = Object.assign(new Writable({ write(chunk, _encoding, done) { term.write(String(chunk), done) } }), { columns, rows, isTTY: true })
  const stderr = new Writable({ write(_chunk, _encoding, done) { done() } })
  const items = Array.from({ length: 40 }, (_, index) => ({ label: `模型${index} 👩‍💻 very-long-model-name`, run() {} }))
  const tree = (focus: number) => <CommandMenu menu={{ title: 'Model', items }} focus={focus} />
  const app = await render(tree(0), { stdin, stdout, stderr, exitOnCtrlC: false, patchConsole: false })
  const lines = () => viewportLines(term)
  const screen = () => lines().join('\n')
  const frame = () => {
    const top = lines().findIndex(line => line.startsWith('╭'))
    const bottom = lines().findIndex(line => line.startsWith('╰'))
    assert(top >= 0 && bottom > top, screen())
    assert(lines()[top].endsWith('╮') && lines()[bottom].endsWith('╯'), 'corners fit the terminal')
    for (const line of lines().slice(top + 1, bottom)) {
      assert(line.startsWith('│') && line.endsWith('│'), `continuous side borders: ${line}`)
    }
    const border = term.buffer.active.getLine(term.buffer.active.baseY + top)?.getCell(0)
    assert.equal(border?.getFgColor(), 0xabc2ec, 'frame uses the permission blue')
  }
  try {
    assert(await settled(() => screen().includes('❯ ● 模型0') && screen().includes('○ 模型1') && screen().includes('╯')), screen())
    frame()
    app.rerender(tree(39))
    assert(await settled(() => screen().includes('❯ ● 模型39') && screen().includes('40/40')), screen())
    frame()
    term.resize(columns, 12)
    Object.assign(stdout, { rows: 12 })
    stdout.emit('resize')
    assert(await settled(() => screen().includes('❯ ● 模型39') && screen().includes('╭') && screen().includes('╯')), screen())
    frame()
    term.resize(columns, rows)
    Object.assign(stdout, { rows })
    stdout.emit('resize')
    app.rerender(<CommandMenu menu={{ title: 'Empty', items: [] }} focus={0} />)
    assert(await settled(() => screen().includes('No options') && screen().includes('╯')), screen())
    frame()
    const answers: unknown[] = []
    const editor = { reasoningEditable: true, read() { return { values: {}, defaults: {} } }, save() {}, edited() { return false } }
    app.rerender(<AskUserQuestionPanel question={{ question: '选择模型', options: items.map(item => ({ label: item.label, description: '模型说明 description' })), hideCustomInput: true, modelEditor: editor }} position={1} total={1} answered={0} onAnswer={answer => answers.push(answer)} onCancel={() => {}} />)
    assert(await settled(() => screen().includes('选择模型') && screen().includes('╯')), screen())
    frame()
    stdin.write('\x1b[B'.repeat(39))
    assert(await settled(() => screen().includes('模型39')), screen())
    frame()
    stdin.write('\r')
    assert(await settled(() => answers.length === 1), screen())
    assert.deepEqual(answers[0], { selected: [items[39].label] })
    stdin.write('\t')
    assert(await settled(() => /Context|ctx|上下文/.test(screen())), screen())
    frame()
    stdin.write('123')
    assert(await settled(() => screen().includes('123')), screen())
    frame()
    app.rerender(<AskUserQuestionPanel key="text" question={{ question: '输入名称' }} position={1} total={1} answered={0} onAnswer={answer => answers.push(answer)} onCancel={() => {}} />)
    assert(await settled(() => screen().includes('输入名称')), screen())
    stdin.write('中文😀')
    assert(await settled(() => screen().includes('中文😀')), screen())
    frame()
    stdin.write('\r')
    assert(await settled(() => answers.length === 2), screen())
    assert.deepEqual(answers[1], { selected: [], custom: '中文😀' })
    console.log(`PASS: blue closed menu/question/editor frames, CJK, focus, empty state and resize at ${columns} columns`)
  } finally {
    await app.unmount()
    term.dispose()
  }
}
