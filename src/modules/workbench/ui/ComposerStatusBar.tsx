import React from 'react'
import { Box, Text, useTerminalSize } from '../../../ui/primitives.js'
import { stringWidth } from '../../../shared/platform/stringWidth.js'
import { getGraphemeSegmenter } from '../../../shared/platform/intl.js'
import { sessionColorHex } from '../../../ui/text/sessionColors.js'
import type { SessionModeSpec } from '../../sessions/contracts.js'

interface ComposerStatusBarProps {
  readonly model: string
  readonly effort?: string
  readonly cwd: string
  readonly sessionTitle?: string
  readonly sessionColor?: string
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
export function ComposerStatusBar({ model, effort, cwd, sessionTitle, sessionColor, mode }: ComposerStatusBarProps): React.ReactNode {
  const { columns } = useTerminalSize()
  const width = Math.max(0, columns - 2)
  const effortText = effort?.trim() ?? ''
  const title = sessionTitle?.trim() ?? ''
  const modeText = mode.label ?? mode.id
  const cycleHint = '(shift+tab to cycle)'
  const modelEffortWidth = stringWidth(model) + (effortText ? stringWidth(` ${effortText}`) : 0)
  const detailTextWidth = (cwd ? 3 + stringWidth(cwd) : 0) + (title ? 3 + stringWidth(title) : 0)
  const hintWidth = stringWidth(` ${cycleHint}`)
  const showCycleHint = width >= modelEffortWidth + detailTextWidth + stringWidth(modeText) + hintWidth + 2
  const rightText = showCycleHint ? `${modeText} ${cycleHint}` : modeText
  const right = shorten(rightText, width)
  const leftWidth = Math.max(0, width - stringWidth(right) - 2)
  const modelWidth = effortText ? leftWidth - stringWidth(` ${effortText}`) : leftWidth
  const modelText = modelWidth > 0 ? shorten(model, modelWidth) : shorten(`${model} ${effortText}`, leftWidth)
  const shownEffort = modelWidth > 0 ? effortText : ''
  const modelEffort = [modelText, shownEffort].filter(Boolean).join(' ')
  const titleColor = sessionColorHex(sessionColor ?? '') ?? 'accent'
  const detailWidth = Math.max(0, leftWidth - stringWidth(modelEffort) - (modelEffort ? 3 : 0))
  // Share the remaining space so a long path cannot hide the session name.
  const cwdWidth = title && detailWidth >= 5
    ? Math.min(stringWidth(cwd), Math.floor((detailWidth - 3) / 2))
    : detailWidth
  const cwdText = shorten(cwd, cwdWidth)
  const titleText = shorten(title, detailWidth - stringWidth(cwdText) - (cwdText ? 3 : 0))
  const left = [modelEffort, cwdText, titleText].filter(Boolean).join(' · ')
  const gap = Math.max(0, width - stringWidth(left) - stringWidth(right))

  return <Box height={1} flexShrink={0} overflow="hidden">
    <Text wrap="truncate-end">
      {' '}
      <Text color="accent">{modelText}</Text>
      {shownEffort ? <Text color="accent">{` ${shownEffort}`}</Text> : null}
      {cwdText && modelEffort ? <Text dimColor>{' · '}</Text> : null}
      <Text color="planMode">{cwdText}</Text>
      {titleText && (modelEffort || cwdText) ? <Text dimColor>{' · '}</Text> : null}
      <Text color={titleColor}>{titleText}</Text>
      {' '.repeat(gap)}
      <Text color="autoAccept">{showCycleHint ? modeText : right}</Text>
      {showCycleHint ? <Text dimColor>{` ${cycleHint}`}</Text> : null}
    </Text>
  </Box>
}
