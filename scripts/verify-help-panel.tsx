/** Help uses the real Chat command-menu path, including short/narrow terminals. */
import './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import React from 'react'
import xtermHeadless from '@xterm/headless'
import { Chat } from '../src/modules/workbench/ui/Chat.js'
import { QuestionStore } from '../src/modules/decisions/model/questions.js'
import { LOCAL_COMMANDS } from '../src/shared/commands.js'
import { render } from '../src/ui/primitives.js'
import { createRuntimeModulesFixture } from './lib/runtime-modules-fixture.js'
import { settled, sleep, viewportLines } from './lib/term-test.mjs'

const { Terminal } = xtermHeadless
for (const [columns, rows] of [[100, 32], [80, 24], [40, 24], [40, 12], [20, 12]]) {
  const term = new Terminal({ cols: columns, rows, allowProposedApi: true })
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} })
  const stdout = Object.assign(new Writable({ write(chunk, _encoding, done) { term.write(String(chunk), done) } }), { columns, rows, isTTY: true })
  const stderr = new Writable({ write(_chunk, _encoding, done) { done() } })
  const submitted: string[] = []
  let newSessions = 0
  let modeChanges = 0
  let nextTranscriptRowId = 0
  let runtime: ReturnType<typeof createRuntimeModulesFixture>
  runtime = createRuntimeModulesFixture({ commands: {
    composer: {
      commandCompletions: () => [], stagedImageGeneration: () => 0,
      hasStagedImage: () => false, discardStagedImage() {},
      submit: text => { submitted.push(text) },
    },
    sessions: {
      newSession: async () => { newSessions++; return true },
      cycleMode: async () => { modeChanges++ },
    },
    transcript: {
      pushLocal: (title, lines, options) => {
        const commandResult = options?.commandResult === true
        const rows = [title, ...lines]
        for (const [index, text] of rows.entries()) {
          const position = !commandResult ? undefined
            : rows.length === 1 ? 'only'
              : index === 0 ? 'start'
                : index === rows.length - 1 ? 'end' : 'middle'
          runtime.transcript.ingress.appendLocalRow({
            id: nextTranscriptRowId++,
            kind: index === 0 ? 'local' : 'local-output',
            text,
            ...(position === undefined ? {} : { commandResult: position }),
          })
        }
      },
    },
    workbench: { notify: () => () => {} },
  } })
  runtime.workbench.ingress.setCommands([
    ...LOCAL_COMMANDS,
    ...Array.from({ length: 25 }, (_, index) => ({ name: `extra-${index}`, description: 'Host command' })),
    { name: 'hidden-skill', description: 'Must not appear', skill: true },
  ])
  const questions = new QuestionStore()
  const app = await render(<Chat ports={runtime} questionStore={questions} approvalStore={{ subscribe: () => () => {}, getSnapshot: () => null, decide() {} }} onExit={() => { throw new Error('Help must not exit') }} />, { stdin, stdout, stderr, exitOnCtrlC: false, patchConsole: false })
  const screen = () => viewportLines(term).join('\n')
  const key = async (input: string) => {
    stdin.write(input)
    await sleep(55) // 固定窗:pacing stdin/React/xterm must finish before the next navigation event.
  }
  const frame = () => {
    const lines = viewportLines(term)
    const top = lines.findIndex(line => line.startsWith('╭'))
    const bottom = lines.findIndex((line, index) => index > top && line.startsWith('╰'))
    assert(top >= 0 && bottom > top, `Complete help frame at ${columns}x${stdout.rows}:\n${screen()}`)
    assert(lines[top].endsWith('╮') && lines[bottom].endsWith('╯'), screen())
    for (const line of lines.slice(top + 1, bottom)) assert(line.startsWith('│') && line.endsWith('│'), screen())
    assert(lines.slice(top, bottom + 1).some(line => line.includes('Esc')), 'shared footer stays visible')
  }
  const root = async () => {
    assert(await settled(() => screen().includes('❯ ● Commands')), `Help opens the shared category menu:\n${screen()}`)
    frame()
  }
  try {
    assert(await settled(() => screen().includes('fixture-model')), screen())
    await key('/help')
    await key('\r')
    await root()
    await key('\r')
    assert(await settled(() => screen().includes('❯ ● Back')), screen())
    frame()
    await key('\x1b[B')
    await key('\r')
    assert(await settled(() => screen().includes('/new') && !screen().includes('Esc cancel')), screen())
    assert.equal(newSessions, 0, 'picking a command fills the draft without executing it')
    assert.deepEqual(submitted, [], 'help Enter never sends a model prompt')
    await key('\x1b')
    await key('?')
    await root()
    await key('\r')
    await key('\x1b[B')
    await key('\r')
    assert(await settled(() => screen().includes('/new') && !screen().includes('Esc cancel')), 'picking the same command again must refill the draft')
    await key('\x1b')
    await key('?')
    await root()
    await key('\r')
    for (let index = 0; index < LOCAL_COMMANDS.length + 25; index++) await key('\x1b[B')
    assert(await settled(() => screen().includes('❯ ● /extra-24')), screen())
    assert(!screen().includes('hidden-skill'), 'skill entries remain hidden')
    frame()
    // Resize the active command list; its last focused row and frame remain visible.
    term.resize(columns, 12)
    stdout.rows = 12
    stdout.emit('resize')
    assert(await settled(() => screen().includes('❯ ● /extra-24') && screen().includes('╮') && screen().includes('╯')), screen())
    frame()
    for (let index = 0; index < LOCAL_COMMANDS.length + 25; index++) await key('\x1b[A')
    await key('\r')
    await root()
    await key('\x1b[B')
    await key('\r')
    assert(await settled(() => screen().includes('❯ ● Back')), screen())
    await key('\x1b[B')
    const before = screen()
    await key('\r')
    await key('x\t\x1b[Z\x16')
    assert.equal(screen(), before, 'read-only Enter, typing, Tab and paste shortcuts cannot edit behind help')
    assert.equal(modeChanges, 0)
    frame()
    await key('\x1b[A\r')
    await root()
    await key('\x1b')
    assert(await settled(() => !screen().includes('Esc cancel')), screen())
    await key('draft-safe')
    await key('\r')
    assert.deepEqual(submitted, ['draft-safe'], 'closing help leaves no hidden input edits')
    await key('?')
    await root()
    await key('\x03')
    assert(await settled(() => !screen().includes('Esc cancel')), screen())
    assert.equal(newSessions, 0)
    if (columns === 40 && rows === 24) {
      runtime.transcript.ingress.setContextOccupancy({ usedTokens: 50, contextWindow: 100, source: 'projection' })
      runtime.activity.ingress.setSubagentSnapshot([], [{
        provider: 'deepseek-official',
        model: 'deepseek-flash',
        buckets: {
          peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          idle: { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 },
        },
      }])
      await key('/status')
      await key('\r')
      assert(await settled(() => {
        const output = screen()
        return output.includes('Context: 50 tokens / 100 tokens')
          && output.includes('(50%)')
          && output.includes('Tokens: input 0')
          && output.includes('cache write 0')
          && output.includes('Estimated session cost: ¥4.0000')
      }), `The /status command renders its session metrics in the 40-column TTY:\n${screen()}`)
    }
    console.log(`PASS: unified help categories, command fill, shortcuts, key ownership and resize at ${columns}x${rows}`)
  } finally {
    questions.rejectAll()
    await app.unmount()
    runtime.dispose()
    term.dispose()
  }
}
