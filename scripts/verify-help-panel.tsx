/** The help overlay shares one frame/footer and keeps commands readable at 80 columns. */
import './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import React from 'react'
import xtermHeadless from '@xterm/headless'
import type { ScrollBoxHandle } from '../src/ui/primitives.js'
import { settled, viewportLines } from './lib/term-test.mjs'

const [{ render }, { HelpMenu }, { SelectionPanel }, { Text }] = await Promise.all([
  import('../src/ui/primitives.js'),
  import('../src/ui/HelpMenu.js'),
  import('../src/ui/SelectionPanel.js'),
  import('../src/ui/primitives.js'),
])
const { Terminal } = xtermHeadless
const commands = Array.from({ length: 20 }, (_, index) => ({
  name: `custom-command-${index}`,
  description: `Description for command ${index}`,
}))

for (const columns of [80, 40]) {
  const rows = 22
  const term = new Terminal({ cols: columns, rows, allowProposedApi: true })
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} })
  const stdout = Object.assign(new Writable({ write(chunk, _encoding, done) { term.write(String(chunk), done) } }), { columns, rows, isTTY: true })
  const stderr = new Writable({ write(_chunk, _encoding, done) { done() } })
  const scrollRef = React.createRef<ScrollBoxHandle>()
  const tree = <SelectionPanel title="/help" footer={<Text dimColor>↑/↓ 滚动 · Esc 关闭</Text>}>
    <HelpMenu commands={commands} viewportHeight={12} viewportWidth={columns} scrollRef={scrollRef} />
  </SelectionPanel>
  const app = await render(tree, { stdin, stdout, stderr, exitOnCtrlC: false, patchConsole: false })
  const screen = () => viewportLines(term).join('\n')
  try {
    assert(await settled(() => screen().includes('↑/↓ 滚动') && screen().includes('╯')), screen())
    assert(!screen().includes('PgUp/PgDn'), `HelpMenu must leave the shared panel footer as the only hint:\n${screen()}`)
    assert(screen().includes('/custom-command-0'), `Commands should be visible when help opens at ${columns} columns:\n${screen()}`)

    scrollRef.current?.scrollTo(9)
    assert(await settled(() => screen().includes('/custom-command-19')), screen())
  } finally {
    await app.unmount()
    term.dispose()
  }
}
console.log('PASS: shared help footer and readable command rows at 80 and 40 columns')
