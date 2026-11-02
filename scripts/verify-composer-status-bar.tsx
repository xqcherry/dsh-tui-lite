/** Focused composer status bar regression. Run with:
 * node --import tsx/esm scripts/verify-composer-status-bar.tsx
 */
import React from 'react'
import { renderToScreen } from '../src/ink/render-to-screen.js'
import { cellAt } from '../src/ink/screen.js'
import { TerminalSizeContext } from '../src/ink/components/TerminalSizeContext.js'
import { ComposerStatusBar } from '../src/modules/workbench/ui/ComposerStatusBar.js'

function render(width: number, effort?: string): string {
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
  return Array.from({ length: width }, (_, column) => cellAt(screen.screen, column, 0)?.char ?? '').join('').trimEnd()
}

const wide = render(100, 'high')
if (!wide.includes('deepseek-flash · high')) throw new Error(`Model effort is missing or misplaced: ${wide}`)
if (!wide.includes('default (shift+tab to cycle)')) throw new Error(`Cycle hint is missing: ${wide}`)

const noEffort = render(100)
if (noEffort.includes('undefined') || noEffort.includes(' ·  · ')) throw new Error(`Missing effort left an empty label: ${noEffort}`)
if (!noEffort.includes('default (shift+tab to cycle)')) throw new Error(`Wide status bar omitted cycle hint: ${noEffort}`)

const narrow = render(50, 'high')
if (narrow.includes('(shift+tab to cycle)')) throw new Error(`Narrow status bar retained the cycle hint: ${narrow}`)
if (!narrow.includes('default') || !narrow.includes('high')) throw new Error(`Narrow status bar lost primary state: ${narrow}`)
if ([...narrow].length > 50) throw new Error(`Narrow status bar overflowed: ${narrow}`)

console.log('Composer status bar verified: model effort, optional effort, cycle hint, and narrow layout')
