/** Focused composer status bar regression. Run with:
 * node --import tsx/esm scripts/verify-composer-status-bar.tsx
 */
import React from 'react'
import { renderToScreen } from '../src/ink/render-to-screen.js'
import { cellAt } from '../src/ink/screen.js'
import { TerminalSizeContext } from '../src/ink/components/TerminalSizeContext.js'
import { ComposerStatusBar } from '../src/modules/workbench/ui/ComposerStatusBar.js'

function render(width: number, effort?: string): { line: string; screen: ReturnType<typeof renderToScreen>['screen'] } {
  const screen = renderToScreen(
    <TerminalSizeContext.Provider value={{ columns: width, rows: 10 }}>
      <ComposerStatusBar
        model="deepseek-flash"
        effort={effort}
        cwd="~/rep/dsh-tui-lite"
        mode={{ id: 'default' }}
      />
    </TerminalSizeContext.Provider>,
    width,
  )
  return {
    line: Array.from({ length: width }, (_, column) => cellAt(screen.screen, column, 0)?.char ?? '').join('').trimEnd(),
    screen: screen.screen,
  }
}

const wide = render(100, 'high')
if (!wide.line.includes('deepseek-flash high')) throw new Error(`Model effort is missing or misplaced: ${wide.line}`)
if (wide.line.includes('deepseek-flash · high')) throw new Error(`Model and effort should be separated by a space: ${wide.line}`)
if (!wide.line.includes('default (shift+tab to cycle)')) throw new Error(`Cycle hint is missing: ${wide.line}`)
const modelStart = wide.line.indexOf('deepseek-flash')
const effortStart = wide.line.indexOf('high')
if (cellAt(wide.screen, modelStart, 0)?.styleId !== cellAt(wide.screen, effortStart, 0)?.styleId) {
  throw new Error('Model and effort should share the same color')
}

const noEffort = render(100)
if (noEffort.line.includes('undefined') || noEffort.line.includes(' ·  · ')) throw new Error(`Missing effort left an empty label: ${noEffort.line}`)
if (!noEffort.line.includes('default (shift+tab to cycle)')) throw new Error(`Wide status bar omitted cycle hint: ${noEffort.line}`)

const narrow = render(50, 'high')
if (narrow.line.includes('(shift+tab to cycle)')) throw new Error(`Narrow status bar retained the cycle hint: ${narrow.line}`)
if (!narrow.line.includes('default') || !narrow.line.includes('high')) throw new Error(`Narrow status bar lost primary state: ${narrow.line}`)
if ([...narrow.line].length > 50) throw new Error(`Narrow status bar overflowed: ${narrow.line}`)

console.log('Composer status bar verified: model effort, optional effort, cycle hint, and narrow layout')
