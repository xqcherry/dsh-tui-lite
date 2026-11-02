#!/usr/bin/env node
/**
 * Real-input integration for the inline Chat orchestration.
 * Covers draft admission, setup, command failures and keyboard ownership while
 * menus/questions/approvals temporarily suspend the composer.
 * Run: node --import tsx/esm scripts/verify-minimal-chat-input.mjs
 */
import './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import React from 'react'
import chalk from 'chalk'
import xtermHeadless from '@xterm/headless'
import { fixtureModules } from './lib/module-fixtures.mjs'
import { Chat } from '../src/modules/workbench/ui/Chat.js'
import { QuestionStore } from '../src/modules/decisions/model/questions.js'
import { LOCAL_COMMANDS } from '../src/shared/commands.js'
import { appendHistory } from '../src/modules/composer/model/history.js'
import { render } from '../src/ui/primitives.js'
import { settled, sleep, viewportLines } from './lib/term-test.mjs'
import { stringWidth } from '../src/shared/platform/stringWidth.js'

// Piped test output still represents a truecolor terminal.
chalk.level = 3

const { Terminal: XTerm } = xtermHeadless

async function fixture(options = {}) {
  const term = new XTerm({ cols: options.columns ?? 100, rows: 32, scrollback: 200, allowProposedApi: true })
  const stdin = new PassThrough()
  stdin.isTTY = true
  stdin.setRawMode = () => stdin
  stdin.setEncoding = () => stdin
  stdin.ref = () => stdin
  stdin.unref = () => stdin
  const stdout = new Writable({ write(chunk, _encoding, callback) { term.write(String(chunk), callback) } })
  stdout.columns = options.columns ?? 100
  stdout.rows = 32
  stdout.isTTY = true
  const stderr = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  stderr.isTTY = true
  const listeners = new Set()
  const approvals = new Set()
  const submitted = []
  const renamed = []
  const permissions = []
  const notices = []
  const decisions = []
  let approval = null
  let exits = 0
  let cancels = 0
  let configured = false
  let configurationProbe = async () => configured
  let rejectRename = false
  const channel = {
    version: 0,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    emit() { channel.version++; for (const listener of listeners) listener() },
    agentId: 'chat-input-test', agentBindingGeneration: 0,
    rows: [], pending: [], notifications: [], cwd: '/chat-input-test',
    model: 'unset', provider: 'deepseek', status: 'idle',
    working: false, mode: { id: 'default', plan: false }, modeIndex: 0,
    commandList: [...LOCAL_COMMANDS, { name: 'remote', description: 'Host command', external: true }],
    async runExternalCommandOutcome(name, raw) {
      assert.equal(name, 'remote')
      assert.equal(raw, ' payload')
      return { kind: 'error', text: 'registry admission refused', consumeDraft: false }
    },
    commandCompletions: () => [],
    notify(text, options) { notices.push(text); channel.notifications.push({ text, ...options }); channel.emit() },
    submit(text) { submitted.push(text) }, steer(text) { submitted.push(text) },
    interruptAndDeliver() { throw new Error('unexpected immediate delivery') },
    cancel() { cancels++ },
    async listModels() { return [{ id: 'configured', name: 'Configured model', provider: 'deepseek' }] },
    async switchModel(provider, model) { channel.provider = provider; channel.model = model; configured = true; channel.emit(); return true },
    async listEfforts() { return { efforts: options.efforts ?? [], defaultEffort: 'high' } },
    async setEffort(id) { channel.reasoningEffort = id; channel.emit(); return true },
    providerSetup: () => undefined,
    setSessionColor(color) { channel.sessionColor = color; channel.emit() },
    async renameSession(title) { renamed.push(title); if (rejectRename) throw new Error('rename failed'); return true },
    permissionPresets: () => ({ options: [{ value: 'first', name: 'First', description: '' }, { value: 'second', name: 'Second', description: '' }] }),
    async runPermissionPreset(value) { permissions.push(value); return true },
    stagedImageGeneration: () => 0,
    hasStagedImage: () => false,
    discardStagedImage() {},
  }
  const questionStore = new QuestionStore()
  const approvalStore = {
    subscribe(listener) { approvals.add(listener); return () => approvals.delete(listener) },
    getSnapshot: () => approval,
    decide(outcome) { decisions.push(outcome); approval = null; for (const listener of approvals) listener() },
  }
  const instance = await render(React.createElement(Chat, {
    ports: fixtureModules(channel), questionStore, approvalStore,
    initialPrompt: options.initialPrompt,
    modelConfigured: () => configurationProbe(),
    onExit() { exits++ },
  }), { stdin, stdout, stderr, exitOnCtrlC: false, patchConsole: false })
  await sleep(150)
  const screen = () => viewportLines(term).join('\n')
  async function key(bytes) {
    stdin.write(bytes)
    // Cross the composer's 80ms physical-Enter deduplication window and let
    // suspension changes commit before the next user action.
    await sleep(110)
  }
  return {
    channel, questionStore, submitted, renamed, permissions, notices, decisions,
    screen, key,
    foreground(text, offset = 0) {
      for (let row = 0; row < term.rows; row++) {
        const line = term.buffer.active.getLine(term.buffer.active.viewportY + row)
        const col = line?.translateToString().indexOf(text) ?? -1
        if (col >= 0) return line.getCell(col + offset)?.getFgColor()
      }
      return undefined
    },
    setConfigurationProbe(probe) { configurationProbe = probe },
    setRejectRename(value) { rejectRename = value },
    showApproval() {
      approval = { key: 'approval-test', toolName: 'shell', agentId: channel.agentId, command: 'echo test' }
      for (const listener of approvals) listener()
    },
    get exits() { return exits }, get cancels() { return cancels },
    async close() { instance.unmount(); await sleep(20); term.dispose() },
  }
}

const f = await fixture()
try {
  await f.key('保留中文 draft')
  await f.key('\r')
  assert.equal(f.submitted.length, 0)
  assert(f.screen().includes('保留中文 draft'))
  console.log('PASS: Chat refuses an unconfigured send and retains Unicode draft text')

  await f.key('\x03')
  assert.equal(f.exits, 0)
  await f.key('/model')
  await f.key('\r')
  assert(f.screen().includes('Configured model'))
  assert(f.screen().includes('╭') && f.screen().includes('╮') && f.screen().includes('╰') && f.screen().includes('╯'), 'model menu has a closed rounded frame')
  assert(/❯ (?:● )?Configure/.test(f.screen()), 'model menu marks the focused option')
  await f.key('\x1b[B')
  await f.key('\r')
  assert.equal(f.channel.model, 'configured')
  await f.key('a\x1b[Db')
  await f.key('\r')
  assert.deepEqual(f.submitted, ['ba'])
  console.log('PASS: setup model menu enables sends and ordinary arrows edit once')

  await f.key('clear this once')
  await f.key('\x03')
  await f.key('after clear')
  await f.key('\r')
  assert.equal(f.submitted.at(-1), 'after clear')
  assert.equal(f.exits, 0)
  console.log('PASS: Ctrl+C clears the draft without also exiting or retaining hidden text')

  await f.key('/rename /tmp')
  await f.key('\r')
  assert.equal(f.renamed.at(-1), '/tmp')
  f.setRejectRename(true)
  await f.key('/rename keep-on-error')
  await f.key('\r')
  assert(f.screen().includes('/rename keep-on-error'))
  assert(f.notices.includes('rename failed'))
  await f.key('\x03')
  console.log('PASS: slash-leading arguments survive and command errors preserve editable drafts')

  await f.key('/remote payload')
  await f.key('\r')
  assert(f.screen().includes('/remote payload'))
  assert(f.notices.includes('registry admission refused'))
  await f.key('\x03')
  console.log('PASS: registry admission errors are shown and retain their command draft')

  await f.key('/permission')
  await f.key('\r')
  await f.key('\x1b[B\r')
  assert.deepEqual(f.permissions, ['second'])
  assert.equal(f.submitted.length, 2)
  console.log('PASS: menu arrows and Enter are owned by the menu without submitting a draft')

  await appendHistory('history retained draft', f.channel.cwd)
  await f.key('\x12')
  await f.key('history retained')
  await f.key('\r')
  assert(f.screen().includes('history retained draft'))
  await f.key('\r')
  assert.equal(f.submitted.at(-1), 'history retained draft')
  console.log('PASS: Ctrl+R search owns typing and restores a selected history entry')

  await f.key('question preserves draft')
  const answer = f.questionStore.ask({ questions: [{
    id: 'pick', question: 'Choose one', options: [{ label: 'Accept' }], hideCustomInput: true,
  }] })
  await sleep(110)
  await f.key('\r')
  assert.deepEqual((await answer).answers[0].selected, ['Accept'])
  assert.equal(f.submitted.at(-1), 'history retained draft')
  await f.key('\r')
  assert.equal(f.submitted.at(-1), 'question preserves draft')
  console.log('PASS: question confirmation never leaks into the suspended draft')

  await f.key('approval preserves draft')
  f.showApproval()
  await sleep(110)
  await f.key('\x1b')
  assert.deepEqual(f.decisions, ['rejected'])
  assert.equal(f.cancels, 0)
  await f.key('\r')
  assert.equal(f.submitted.at(-1), 'approval preserves draft')
  console.log('PASS: approval Escape rejects once and preserves the suspended draft')

  f.channel.working = true
  f.channel.emit()
  await f.key('keep while cancelling')
  await f.key('\x1b')
  assert.equal(f.cancels, 1)
  assert(f.screen().includes('keep while cancelling'))
  f.channel.working = false
  f.channel.emit()
  await f.key('\r')
  assert.equal(f.submitted.at(-1), 'keep while cancelling')
  console.log('PASS: plain working Escape cancels once and keeps the editable draft')

  let resolveConfiguration
  f.setConfigurationProbe(() => new Promise(resolve => { resolveConfiguration = resolve }))
  f.channel.model = 'pending-route'
  f.channel.emit()
  await f.key('route switch draft')
  const beforeRouteSend = f.submitted.length
  await f.key('\r')
  assert.equal(f.submitted.length, beforeRouteSend)
  assert(f.screen().includes('route switch draft'))
  resolveConfiguration(true)
  await sleep(110)
  await f.key('\r')
  assert.equal(f.submitted.at(-1), 'route switch draft')
  console.log('PASS: changing model routes invalidates readiness until the new check settles')
} finally {
  await f.close()
}

const auth = await fixture({ initialPrompt: 'retain startup task' })
try {
  assert(auth.screen().includes('retain startup task'), 'unconfigured CLI tasks must remain editable')
  await auth.key('\x03')
  const calls = []
  auth.channel.runExternalCommandOutcome = async (name, raw) => {
    calls.push([name, raw.trim()])
    return { kind: 'text', text: 'Account status is available', consumeDraft: true }
  }
  for (const argument of ['status', 'login openai-codex', 'logout openai-codex']) {
    await auth.key('/auth ' + argument)
    await auth.key('\r')
  }
  assert.deepEqual(calls, [
    ['auth', 'status'], ['auth', 'login openai-codex'], ['auth', 'logout openai-codex'],
  ])
  assert(auth.notices.includes('Account status is available'))
  auth.channel.providerSetup = () => ({ oauth: { providers: async () => [{ provider: 'openai-codex', label: 'Codex' }] } })
  await auth.key('/auth login')
  await auth.key('\r')
  assert(auth.screen().includes('/auth'))
  assert(auth.screen().includes('Codex'))
  console.log('PASS: auth verbs delegate to the host, bare login opens a picker, and startup tasks survive setup')
} finally { await auth.close() }

const questions = await fixture()
try {
  const answer = questions.questionStore.ask({ questions: [
    { id: 'first', question: 'First question', options: [{ label: 'Yes' }], hideCustomInput: true },
    { id: 'second', question: 'Second question', options: [{ label: 'Yes' }], hideCustomInput: true },
  ] }).catch(() => null)
  await sleep(110)
  await questions.key('\x1b[C\x1b[27u')
  assert.equal(questions.questionStore.getSnapshot()?.position, 1, 'same-batch forward and Escape should return to the first question, not cancel the batch')
  questions.questionStore.cancelCurrent()
  await answer
  console.log('PASS: batched questionnaire navigation preserves the active question batch')
} finally { questions.questionStore.rejectAll(); await questions.close() }

// Exercise the complete Chat layout in a headless TTY, including live updates.
for (const columns of [100, 40, 20]) {
  const status = await fixture({ columns, initialPrompt: 'footer anchor' })
  try {
    status.channel.model = 'deepseek-flash'
    status.channel.cwd = '/项目/long-workspace-directory'
    status.channel.mode = { id: 'plan', plan: true }
    status.channel.emit()
    assert(await settled(() => {
      const lines = status.screen().split('\n')
      const prompt = lines.findIndex(line => line.includes('footer anchor'))
      const footer = lines[prompt + 2] ?? ''
      const suffix = columns === 100 ? 'plan (shift+tab to cycle)' : 'plan'
      return prompt >= 0 && footer.trimEnd().endsWith(suffix) && stringWidth(footer) === columns - 1
    }), `status must appear immediately below the input border at ${columns} columns`)
    assert(!/Ready|Working|ctx /.test(status.screen()), 'old combined status row must be removed')
    if (columns === 100) {
      assert(status.screen().split('\n').some(line => /deepseek-flash · \/项目\/long-workspace-directory +plan \(shift\+tab to cycle\)$/.test(line)))
    }
    if (columns >= 40) {
      status.channel.sessionTitle = '首次对话'
      status.channel.emit()
      assert(await settled(() => {
        const lines = status.screen().split('\n')
        const prompt = lines.findIndex(line => line.includes('footer anchor'))
        const footer = lines[prompt + 2] ?? ''
        const suffix = columns === 100 ? 'plan (shift+tab to cycle)' : 'plan'
        return /deepseek-flash · .+ · 首次(?:对话|…) +/.test(footer) && footer.trimEnd().endsWith(suffix)
          && stringWidth(footer) === columns - 1
      }), 'real session title must follow the directory once published')
      status.channel.sessionTitle = '已重命名'
      status.channel.emit()
      const suffix = columns === 100 ? '(shift+tab to cycle)' : 'plan'
      assert(await settled(() => status.screen().split('\n').some(line => line.includes(' · 已重') && line.trimEnd().endsWith(suffix))), 'renames must update the footer')
      status.channel.sessionTitle = ''
      status.channel.emit()
      assert(await settled(() => !status.screen().includes('已重命名') && !status.screen().includes('已重…')), 'a new session must clear the previous title')
    }
    status.channel.model = 'a-very-long-model-name-that-exceeds-the-terminal-width'
    status.channel.mode = { id: 'custom-mode', label: '自定义模式', plan: false }
    status.channel.emit()
    assert(await settled(() => {
      const lines = status.screen().split('\n')
      const prompt = lines.findIndex(line => line.includes('footer anchor'))
      const footer = lines[prompt + 2] ?? ''
      return prompt >= 0 && footer.endsWith('自定义模式') && stringWidth(footer) === columns - 1
        && footer.startsWith(columns === 100 ? ' a-very-long-model-name' : ' a-')
        && (columns === 100 || (footer.includes('…') && !footer.includes(' · ')))
        && lines.slice(prompt + 3).every(line => line.trim() === '')
    }), 'long model and custom mode must share one aligned row without wrapping')
    const prefix = 'x'.repeat(columns - 6)
    status.channel.mode = { id: 'custom-mode', label: `${prefix}👩‍💻developer` }
    status.channel.emit()
    assert(await settled(() => status.screen().includes(`${prefix}👩‍💻d…`)), 'mode truncation must preserve complete emoji graphemes')
    console.log(`PASS: status footer placement and live updates at ${columns} TTY columns`)
  } finally { await status.close() }
}

// The second model-selection step owns keys even in a narrow terminal.
for (const columns of [40, 20]) {
  const flow = await fixture({ columns, efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] })
  try {
    flow.channel.reasoningEffort = 'high'
    flow.channel.emit()
    await sleep(110)
    assert(!flow.screen().includes('HIGH'), 'empty composer must not display the effort badge')
    await flow.key('/model')
    await flow.key('\r')
    await flow.key('\x1b[B')
    await flow.key('\r')
    assert(flow.screen().includes('○ High ('), 'unfocused effort option remains visible in a narrow TTY')
    await flow.key('\r')
    assert.equal(flow.channel.reasoningEffort, 'low')
    assert.equal(flow.submitted.length, 0, 'tier confirmation must not submit a prompt')
    await flow.key('/model deepseek/other')
    await flow.key('\r')
    assert(flow.screen().includes('/model'))
    await flow.key('\x1b')
    assert.equal(flow.channel.model, 'other', 'Escape keeps the switched model')
    assert.equal(flow.channel.reasoningEffort, 'low', 'Escape keeps the applied tier')
    await flow.key('中文输入')
    assert(flow.screen().includes('中文输入'))
    await flow.key('\r')
    assert.deepEqual(flow.submitted, ['中文输入'])
    console.log(`PASS: model/effort selection, cancellation and Chinese input at ${columns} TTY columns`)
  } finally { await flow.close() }
}

// /color owns menu keys and changes only the border and session title.
for (const columns of [40, 20]) {
  const colors = await fixture({ columns })
  try {
    colors.channel.model = 'm'
    colors.channel.cwd = '/w'
    colors.channel.sessionTitle = 'zz'
    colors.channel.mode = { id: 'N', plan: false }
    colors.channel.emit()
    assert(await settled(() => colors.screen().includes('m · /w ·')))
    const original = {
      model: colors.foreground('m · /w'), cwd: colors.foreground('/w'),
      mode: colors.foreground('N'), title: colors.foreground('zz'),
      border: colors.foreground('╭'),
    }
    await colors.key('/color')
    await colors.key('\r')
    assert(colors.screen().includes('default'))
    await colors.key('\x1b[B')
    await colors.key('\x1b')
    assert.equal(colors.channel.sessionColor, undefined, 'Escape must cancel without applying the highlighted color')
    await colors.key('/color')
    await colors.key('\r')
    for (let index = 0; index < 8; index++) await colors.key('\x1b[B')
    assert(colors.screen().includes('cyan'), 'last color remains reachable in a narrow picker')
    await colors.key('\r')
    assert.equal(colors.channel.sessionColor, 'cyan')
    assert(await settled(() => colors.foreground('╭') === 0x12A594))
    assert.equal(colors.foreground('zz'), 0x12A594)
    assert.equal(colors.foreground('m · /w'), original.model)
    assert.equal(colors.foreground('/w'), original.cwd)
    assert.equal(colors.foreground('N'), original.mode)
    colors.channel.mode = { id: 'Plan', plan: true }
    colors.channel.emit()
    assert(await settled(() => colors.foreground('╭') !== 0x12A594), 'Plan border overrides session color')
    assert.equal(colors.foreground('zz'), 0x12A594, 'Plan mode must preserve the chosen title color')
    colors.channel.mode = { id: 'N', plan: false }
    colors.channel.emit()
    await colors.key('/color default')
    await colors.key('\r')
    assert.equal(colors.channel.sessionColor, '')
    assert(await settled(() => colors.foreground('╭') === original.border))
    assert.equal(colors.foreground('zz'), original.title)
    assert.deepEqual(colors.submitted, [], 'local colors never reach the model')
    colors.channel.pending = [{ id: 'dock', text: 'dock-note', docked: true }]
    colors.channel.emit()
    assert(await settled(() => colors.screen().includes('dock-note')))
    await colors.key('\x1b[A')
    assert(colors.screen().includes('❯ dock-note'))
    const dockColor = colors.foreground('dock-note')
    colors.channel.sessionColor = 'cyan'
    colors.channel.emit()
    assert(await settled(() => colors.foreground('╭') === 0x12A594))
    assert.equal(colors.foreground('dock-note'), dockColor, 'session color must not change selected pending-message text')
    console.log(`PASS: color picker, cancellation, border/title RGB and Plan priority at ${columns} TTY columns`)
  } finally { await colors.close() }
}
