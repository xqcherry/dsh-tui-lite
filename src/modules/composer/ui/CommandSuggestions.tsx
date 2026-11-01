import React from 'react'
import type { CommandSuggestionsSnapshot } from '../model/command-suggestions.js'
import type { WheelEvent } from '../../../ink/events/wheel-event.js'
import { truncateToWidth } from '../../../ink/truncateToWidth.js'
import { stringWidth } from '../../../shared/platform/stringWidth.js'
import { localizedDescription } from '../../../shared/commands.js'
import { Box, Text } from '../../../ui/primitives.js'

const DESCRIPTION_GAP = 4
const PRIMARY_COLUMN_WIDTH = 32

/** A flat, one-row-per-command list below the prompt's bottom border. */
export function CommandSuggestions({ snapshot, columns, maxRows, onPick, onWheelStep }: {
  snapshot: CommandSuggestionsSnapshot
  columns: number
  maxRows: number
  onPick(index: number): void
  onWheelStep(step: 1 | -1): void
}): React.ReactNode {
  const { items, selectedIndex } = snapshot
  if (items.length === 0 || maxRows < 1) return null
  const counter = items.length > Math.min(5, maxRows) && maxRows > 1
  const visibleCount = Math.min(5, maxRows - (counter ? 1 : 0))
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(visibleCount / 2), items.length - visibleCount))
  const primaryWidth = PRIMARY_COLUMN_WIDTH
  const width = Math.max(0, columns - 2)
  const handleWheel = (event: WheelEvent): void => {
    event.stopImmediatePropagation()
    if (event.deltaY !== 0) onWheelStep(event.deltaY > 0 ? 1 : -1)
  }
  return (
    <ink-box style={{ flexDirection: 'column', flexShrink: 0, width: '100%' }} onWheel={handleWheel}>
      {items.slice(start, start + visibleCount).map((item, offset) => {
        const index = start + offset
        const selected = index === selectedIndex
        const nameWidth = Math.max(0, Math.min(primaryWidth - DESCRIPTION_GAP, width - 2))
        const name = truncateToWidth(item.name.replace(/[\r\n]+/g, ' '), nameWidth)
        const gap = ' '.repeat(Math.max(DESCRIPTION_GAP, primaryWidth - stringWidth(name)))
        const remaining = width - 2 - stringWidth(name) - gap.length
        const description = columns > 40 && remaining > 10
          ? truncateToWidth(localizedDescription(item).replace(/[\r\n]+/g, ' ').trim(), remaining)
          : ''
        const label = truncateToWidth(`${selected ? '→ ' : '  '}${name}${description ? gap + description : ''}`, Math.max(0, columns))
        return (
          <Box key={item.commandLine} flexShrink={0} height={1} onClick={event => { event.stopImmediatePropagation(); onPick(index) }}>
            <Text wrap="truncate-end" color={selected ? 'suggestion' : undefined} bold={selected}>{label}</Text>
          </Box>
        )
      })}
      {counter && <Text dimColor wrap="truncate-end">{truncateToWidth(`  (${selectedIndex + 1}/${items.length})`, width)}</Text>}
    </ink-box>
  )
}
