/** Answered questionnaire record: a framed Q/A result, never a `!` shell echo. */
import './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import React from 'react'
import xtermHeadless from '@xterm/headless'
import { settled, viewportLines } from './lib/term-test.mjs'
import type { ChatRow } from '../src/shared/protocol/transcript.js'

process.env.FORCE_COLOR = '3'
const [{ render }, { MessageList }, { buildQuestionRecord }] = await Promise.all([
  import('../src/ui/primitives.js'),
  import('../src/modules/transcript/ui/MessageList.js'),
  import('../src/modules/transcript/model/question-record.js'),
])

const record = buildQuestionRecord(
  [{ question: 'Which palette?' }, { question: 'Any notes?' }],
  [{ selected: ['Cool'] }, { selected: [], custom: 'Keep it short' }],
)
assert.equal(record.title, 'Questionnaire · 2 answered')
assert.deepEqual(record.lines.map(line => line.text), [
  'Q: Which palette?',
  'A: Cool',
  'Q: Any notes?',
  'A: Keep it short',
])
assert.deepEqual(record.lines.map(line => line.emphasis === true), [false, true, false, true])

const rows: ChatRow[] = [
  { id: 1, kind: 'local', text: record.title, seq: 10, commandResult: 'start' },
  ...record.lines.map((line, index): ChatRow => ({
    id: index + 2,
    kind: 'local-output',
    text: line.text,
    seq: 10,
    commandResult: index === record.lines.length - 1 ? 'end' : 'middle',
    ...(line.emphasis === true ? { emphasis: true } : {}),
  })),
]

const { Terminal } = xtermHeadless
for (const columns of [80, 40, 20]) {
  const terminalRows = 24
  const term = new Terminal({ cols: columns, rows: terminalRows, allowProposedApi: true })
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} })
  const stdout = Object.assign(new Writable({
    write(chunk, _encoding, done) { term.write(String(chunk), done) },
  }), { columns, rows: terminalRows, isTTY: true })
  const stderr = new Writable({ write(_chunk, _encoding, done) { done() } })
  const screen = (): string => viewportLines(term).join('\n')
  const app = await render(<MessageList
    rows={rows}
    expanded={false}
    expandedRows={new Set()}
    selectedId={null}
    onToggleRow={() => {}}
    model="deepseek-chat"
  />, { stdin, stdout, stderr, exitOnCtrlC: false, patchConsole: false })
  try {
    assert(await settled(() => screen().includes('Questionnaire')), screen())
    assert(screen().includes('┌') && screen().includes('└'), `record uses the command-result frame\n${screen()}`)
    assert(screen().includes('Q:') && screen().includes('A:'), 'record shows Q/A prefixes')
    if (columns >= 40) {
      assert(screen().includes('Q: Which palette?'), screen())
      assert(screen().includes('A: Cool'), screen())
    }
    const lines = viewportLines(term)
    assert(!lines.some(line => line.trimStart().startsWith('!')), 'record must not render as a shell echo')
    assert(!screen().includes('📋'), 'record title has no emoji')
    assert(!screen().includes('→'), 'record uses Q/A lines, not an arrow')
  } finally {
    await app.unmount()
  }
}
console.log('Question record passed: framed Q/A rows at 80/40/20 columns')
