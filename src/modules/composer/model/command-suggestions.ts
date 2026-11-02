import type { CommandCompletion } from '../../../shared/protocol/commands.js'
import { MAX_VISIBLE_LINES, wrapToWidth } from './geometry.js'

/** Reserve prompt borders, margin, status/setup lines and the cursor park. */
export function commandSuggestionRows(input: string, columns: number, terminalRows: number, homeButtonCols: number): number {
  if (columns < 4 || !input.startsWith('/') || /[\r\n]/.test(input)) return 0
  const inputRows = Math.min(MAX_VISIBLE_LINES, wrapToWidth(input, Math.max(1, columns - 4 - homeButtonCols)).length)
  return Math.max(0, Math.min(6, terminalRows - inputRows - 6))
}

export interface CommandSuggestionsSnapshot {
  readonly items: readonly CommandCompletion[]
  readonly selectedIndex: number
  readonly root: boolean
}

/** Synchronous mirrors let render and every key in one stdin batch agree. */
export function createCommandSuggestions(complete: (input: string) => readonly CommandCompletion[]) {
  let query = ''
  let dismissed: string | undefined
  let selectedIndex = 0
  let selectedLine: string | undefined

  const read = (input: string, cursor: number, enabled: boolean): CommandSuggestionsSnapshot => {
    if (input !== query) {
      query = input
      dismissed = undefined
      selectedIndex = 0
      selectedLine = undefined
    }
    const root = !/[\t ]/.test(input)
    if (!enabled || cursor !== input.length || !input.startsWith('/') || /[\r\n]/.test(input) || dismissed === input) {
      return { items: [], selectedIndex: 0, root }
    }
    const items = complete(input)
    const preserved = items.findIndex(item => item.commandLine === selectedLine)
    const exact = items.findIndex(item => item.commandLine === input)
    selectedIndex = preserved >= 0 ? preserved : exact >= 0 ? exact : Math.min(selectedIndex, Math.max(0, items.length - 1))
    selectedLine = items[selectedIndex]?.commandLine
    return { items, selectedIndex, root }
  }

  return {
    read,
    dismiss(input: string): void { dismissed = input },
    reopen(): void { dismissed = undefined },
    move(snapshot: CommandSuggestionsSnapshot, delta: number, wrap = true): void {
      const count = snapshot.items.length
      if (count === 0) return
      selectedIndex = wrap
        ? (snapshot.selectedIndex + delta + count) % count
        : Math.max(0, Math.min(count - 1, snapshot.selectedIndex + delta))
      selectedLine = snapshot.items[selectedIndex]?.commandLine
    },
  }
}
