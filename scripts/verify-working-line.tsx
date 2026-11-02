/** Focused working-status-line regression. Run with:
 * node --import tsx/esm scripts/verify-working-line.tsx
 */
import assert from 'node:assert/strict'
import React from 'react'
import chalk from 'chalk'
import { renderToScreen } from '../src/ink/render-to-screen.js'
import { cellAt } from '../src/ink/screen.js'
import { ClockContext, type Clock } from '../src/ink/components/ClockContext.js'
import { TerminalSizeContext } from '../src/ink/components/TerminalSizeContext.js'
import { WorkingStatusLine, type WorkingStatusLineProps } from '../src/modules/workbench/ui/WorkingStatusLine.js'
import { stringWidth } from '../src/shared/platform/stringWidth.js'
import type { SpinnerMode } from '../src/shared/protocol/display.js'
import { BLACK_CIRCLE } from '../src/ui/text/figures.js'

// The test process has piped stdout; emulate the truecolor TTY under test.
chalk.level = 3

function clockAt(time: number): Clock {
  return {
    now: () => time,
    subscribe: () => () => {},
    setTickInterval: () => {},
    suspend: () => {},
  }
}

function render(
  props: Omit<WorkingStatusLineProps, 'working'> & { working?: boolean },
  width = 80,
  time = 0,
): { height: number; line: string; screen: ReturnType<typeof renderToScreen>['screen'] } {
  const { working = true, ...rest } = props
  const { height, screen } = renderToScreen(
    <ClockContext.Provider value={clockAt(time)}>
      <TerminalSizeContext.Provider value={{ columns: width, rows: 10 }}>
        <WorkingStatusLine {...rest} working={working} />
      </TerminalSizeContext.Provider>
    </ClockContext.Provider>,
    width,
  )
  return {
    height,
    line: Array.from({ length: width }, (_, column) => cellAt(screen, column, 0)?.char ?? '').join('').trim(),
    screen,
  }
}

const idle = render({ working: false, spinnerMode: 'thinking', turnStart: 0, activeToolCount: 0 })
assert.equal(idle.height, 0, 'idle renders no reserved row')
assert.equal(idle.line, '', 'idle renders no text')

const phases: Array<[SpinnerMode, string]> = [
  ['requesting', 'Waiting for model'],
  ['thinking', 'Thinking'],
  ['responding', 'Responding'],
  ['tool-input', 'Preparing tool'],
  ['tool-use', 'Running Bash'],
]
for (const [spinnerMode, expected] of phases) {
  const rendered = render({ spinnerMode, turnStart: 0, activeToolCount: 1, toolName: 'Bash' })
  assert.equal(rendered.height, 1, `${spinnerMode} occupies one row`)
  assert(rendered.line.includes(expected), `${spinnerMode} label: ${rendered.line}`)
  assert(rendered.line.startsWith(BLACK_CIRCLE), `${spinnerMode} starts with the activity dot: ${rendered.line}`)
}

const parallel = render({ spinnerMode: 'tool-use', turnStart: 0, activeToolCount: 3 })
assert(parallel.line.includes('Running 3 tools'), `parallel tool count: ${parallel.line}`)
const unnamed = render({ spinnerMode: 'tool-use', turnStart: 0, activeToolCount: 0 })
assert(unnamed.line.includes('Running tool'), `generic tool label: ${unnamed.line}`)
const whitespace = render({ spinnerMode: 'tool-use', turnStart: 0, activeToolCount: 1, toolName: '  Read\nfile  ' })
assert(whitespace.line.includes('Running Read file'), `tool label collapses whitespace: ${whitespace.line}`)

const timed = render({ spinnerMode: 'thinking', turnStart: 10_000, activeToolCount: 0, now: () => 22_500 }, 80, 0)
assert(timed.line.includes('12s'), `elapsed time is shown: ${timed.line}`)
const untimed = render({ spinnerMode: 'thinking', turnStart: 0, activeToolCount: 0 })
assert(!untimed.line.includes('0s'), `unknown turn start omits elapsed time: ${untimed.line}`)

const narrow = render(
  { spinnerMode: 'tool-use', turnStart: 0, activeToolCount: 1, toolName: 'a-very-long-tool-name-that-cannot-fit' },
  24,
)
assert(stringWidth(narrow.line) <= 24, `narrow line stays inside the terminal: ${narrow.line}`)
assert(narrow.line.includes('Running'), `narrow line keeps the phase: ${narrow.line}`)

const breathingStart = render({ spinnerMode: 'thinking', turnStart: 0, activeToolCount: 0 }, 80, 0)
const breathingPeak = render({ spinnerMode: 'thinking', turnStart: 0, activeToolCount: 0 }, 80, 450)
assert.notEqual(
  cellAt(breathingStart.screen, 1, 0)?.styleId,
  cellAt(breathingPeak.screen, 1, 0)?.styleId,
  'the activity dot breathes between two colors',
)

console.log('Working status line verified: phases, tool labels, elapsed time, narrow width and breathing dot')
