import React from 'react'
import { Box, Text, useTerminalSize } from '../../../ui/primitives.js'
import { stringWidth } from '../../../shared/platform/stringWidth.js'
import { getGraphemeSegmenter } from '../../../shared/platform/intl.js'
import type { SessionModeSpec } from '../../sessions/contracts.js'

interface ComposerStatusBarProps {
  readonly model: string
  readonly cwd: string
  readonly mode: SessionModeSpec
}

function shorten(text: string, width: number): string {
  if (width <= 0) return ''
  if (stringWidth(text) <= width) return text
  let result = ''
  let used = 0
  for (const { segment } of getGraphemeSegmenter().segment(text)) {
    const cells = stringWidth(segment)
    if (used + cells > width - 1) break
    result += segment
    used += cells
  }
  return `${result}…`
}

/** A single terminal row; reserve the mode before budgeting the left side. */
export function ComposerStatusBar({ model, cwd, mode }: ComposerStatusBarProps): React.ReactNode {
  const { columns } = useTerminalSize()
  const width = Math.max(0, columns - 2)
  const right = shorten(mode.label ?? mode.id, width)
  const leftWidth = Math.max(0, width - stringWidth(right) - 2)
  const modelText = shorten(model, leftWidth)
  const cwdText = shorten(cwd, leftWidth - stringWidth(modelText) - 3)
  const left = cwdText ? `${modelText}${modelText ? ' · ' : ''}${cwdText}` : modelText
  const gap = Math.max(0, width - stringWidth(left) - stringWidth(right))

  return <Box height={1} flexShrink={0} overflow="hidden">
    <Text dimColor wrap="truncate-end">{` ${left}${' '.repeat(gap)}${right}`}</Text>
  </Box>
}
