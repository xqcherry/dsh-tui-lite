#!/usr/bin/env node
/**
 * Source regression for configuration admission at the composer boundary.
 * Refused sends must retain the draft and leave history, staged images and
 * pending delivery untouched. Local configuration commands remain available.
 * Run: node --import tsx/esm scripts/verify-prompt-submit-guard.mjs
 */
import './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import React from 'react'
import { PromptInput } from '../src/tui/components/PromptInput.js'
import { render } from '../src/tui/primitives.js'
import { loadHistory } from '../src/app/input/history.js'
import { settled, sleep } from './lib/term-test.mjs'

const stdin = new PassThrough()
stdin.isTTY = true
stdin.setRawMode = () => stdin
stdin.setEncoding = () => stdin
stdin.ref = () => stdin
stdin.unref = () => stdin
const stdout = new Writable({ write(_chunk, _encoding, callback) { callback() } })
stdout.columns = 90
stdout.rows = 30
stdout.isTTY = true
const stderr = new Writable({ write(_chunk, _encoding, callback) { callback() } })
stderr.isTTY = true

let ready = false
let refusals = 0
let deliveries = 0
let interrupts = 0
const submitted = []
const submittedImages = []
const steered = []
const commands = []
const controllerRef = { current: null }
const channel = {
  agentId: 'guard-test',
  cwd: '/guard-test',
  mode: { id: 'default', plan: false },
  modeIndex: 0,
  working: false,
  commandList: [
    { name: 'provider', description: 'Configure a provider' },
    { name: 'practice', description: 'A model-routed skill', skill: true },
    { name: 'registered', description: 'A host-registered skill', skill: true, external: true },
  ],
  commandCompletions: () => [],
  pending: [],
  notifications: [],
  notify() {},
  submit(text, images) { submitted.push(text); submittedImages.push(images) },
  steer(text) { steered.push(text) },
  interruptAndDeliver() { interrupts++; return 1 },
  deliverDocked() { deliveries++; return 1 },
  stagedImageGeneration: () => 0,
  hasStagedImage: id => id === 'guard-image',
  removePending(id) {
    const index = channel.pending.findIndex(item => item.id === id)
    if (index < 0) return false
    channel.pending.splice(index, 1)
    return true
  },
  discardStagedImage() { throw new Error('refused send discarded an image') },
}

const props = {
  channel,
  controllerRef,
  helpOpen: false,
  onToggleHelp() {},
  selectionActive: false,
  beforeSubmit() { if (!ready) refusals++; return ready },
  onRunCommand(name) { commands.push(name); return true },
}
const instance = await render(React.createElement(PromptInput, props), {
  stdin, stdout, stderr, exitOnCtrlC: false, patchConsole: false,
})

async function fill(text) {
  controllerRef.current.clear()
  controllerRef.current.append(text)
  await sleep(100)
  assert.equal(controllerRef.current.text(), text)
}

async function refused(name, text, key) {
  await fill(text)
  const before = refusals
  stdin.write(key)
  assert(await settled(() => refusals === before + 1), `${name}: preflight was skipped`)
  assert.equal(controllerRef.current.text(), text, `${name}: draft was changed`)
  assert.equal(submitted.length, 0, `${name}: submitted a message`)
  assert.equal(steered.length, 0, `${name}: steered a message`)
  assert.equal(interrupts, 0, `${name}: interrupted delivery`)
  assert.equal(deliveries, 0, `${name}: delivered pending messages`)
  assert(!loadHistory(channel.cwd).some(entry => entry.text === text), `${name}: wrote history`)
  console.log(`PASS: ${name} preserves the refused draft`)
}

try {
  assert(await settled(() => controllerRef.current !== null))
  await refused('Enter', '保留中文 draft', '\r')
  channel.working = true
  await refused('streaming Enter', 'keep steering draft', '\r')
  await refused('streaming Tab', 'keep queued draft', '\t')
  await refused('Ctrl+Enter', 'keep immediate draft', '\x1b[13;5u')
  channel.working = false
  channel.pending.push({ id: 'docked-1', text: 'pending', docked: true })
  await refused('docked queue Enter', '', '\r')
  assert.equal(channel.pending.length, 1)
  channel.pending.length = 0
  await refused('model-routed skill', '/practice', '\r')
  await refused('host-registered skill', '/registered', '\r')
  assert.deepEqual(commands, [])

  await fill('/provider')
  stdin.write('\r')
  assert(await settled(() => commands.includes('provider')))
  assert.equal(controllerRef.current.text(), '')
  console.log('PASS: local provider configuration is available before model setup')

  await fill('ready to send 中文')
  ready = true
  stdin.write('\r')
  assert(await settled(() => submitted.length === 1))
  assert.equal(submitted[0], 'ready to send 中文')
  assert.equal(controllerRef.current.text(), '')
  console.log('PASS: configured input sends once and clears the admitted draft')

  await fill('/practice lesson')
  stdin.write('\r')
  assert(await settled(() => submitted.length === 2))
  assert.equal(submitted[1], '/practice lesson')
  assert.deepEqual(commands, ['provider'])
  console.log('PASS: completion-only skills send their original text through model admission')

  ready = false
  channel.pending.push({ id: 'image-recall', text: '[Image #1]', images: [{ token: '[Image #1]', stageId: 'guard-image' }] })
  stdin.write('\x1b[1;3A')
  assert(await settled(() => controllerRef.current.text() === '[Image #1]'))
  await sleep(100)
  const beforeImageRefusal = refusals
  stdin.write('\r')
  assert(await settled(() => refusals === beforeImageRefusal + 1))
  assert.equal(controllerRef.current.text(), '[Image #1]')
  assert.equal(submitted.length, 2)
  ready = true
  await sleep(100)
  stdin.write('\r')
  assert(await settled(() => submitted.length === 3))
  assert.equal(submittedImages.at(-1)[0].stageId, 'guard-image')
  console.log('PASS: refusing setup preserves a staged image capability until later delivery')
} finally {
  instance.unmount()
}
