import React from 'react'
import type { ChatMenu } from '../model/chat-commands.js'
import { Box, Text, useTerminalSize } from '../../../ui/primitives.js'
import { SelectionPanel } from '../../../ui/SelectionPanel.js'
import { listWindow } from '../../../ui/listWindow.js'
import wrapText from '../../../ink/wrap-text.js'
import { truncateToWidth } from '../../../ink/truncateToWidth.js'

export function CommandMenu({ menu, focus }: { menu: ChatMenu; focus: number }): React.ReactNode {
  const { columns, rows } = useTerminalSize()
  // Reserve chat chrome, frame, title and hint rows before windowing options.
  const spacing = rows < 18 ? 0 : 1
  const controls = columns < 40 || rows < 18 ? '↑↓ · Enter · Esc' : '↑/↓ select · Enter confirm · Esc cancel'
  const hint = menu.items.length > 0 ? `${focus + 1}/${menu.items.length} · ${controls}` : 'Esc cancel'
  const hintRows = wrapText(hint, Math.max(1, columns - 4), 'wrap').split('\n').length
  const budget = Math.max(1, rows - 11 - spacing * 3 - hintRows)
  const { start, end } = listWindow(menu.items.map(() => 1), focus, budget)
  const width = Math.max(0, columns - 6)
  return <SelectionPanel title={menu.title} footer={<Text dimColor wrap="wrap">
    {hint}
  </Text>}>
    {menu.items.length === 0 ? <Text dimColor>No options available</Text> : menu.items.slice(start, end).map((item, index) => {
      const selected = start + index === focus
      const label = truncateToWidth(item.label.replace(/[\r\n]+/g, ' '), width)
      return <Box key={start + index} height={1} flexShrink={0}>
        <Text color={selected ? 'suggestion' : undefined} bold={selected} wrap="truncate-end">{`${selected ? '❯' : ' '} ${label}`}</Text>
      </Box>
    })}
  </SelectionPanel>
}
