import React from 'react'
import type { ClickEvent } from '../../../ink/events/click-event.js'
import type { DOMElement } from '../../../ink/dom.js'
import { t } from '../../../shared/i18n.js'
import { formatDuration, formatTokens } from '../../../ui/text/format.js'
import { Box, Text, useAnimationFrame } from '../../../ui/primitives.js'
import { StreamingMarkdown } from '../../../ui/StreamingMarkdown.js'
import { getTheme } from '../../../ui/theme.js'
import { interpolateColor, parseRGB, toRGBColor } from '../../../ui/Spinner/spinnerUtils.js'

const BREATH_TICK_MS = 80
const BREATH_PERIOD_MS = 1800

/**
 * Reasoning row, OpenCode style: one breathing activity dot, the phase
 * (`Thinking` while live, `Thought` once settled) and the elapsed duration.
 * The summary and the expand hint are deliberately absent; Ctrl+O (or a
 * click) still opens the full reasoning body.
 */
export function AssistantThinkingMessage({
  thinking,
  streaming = false,
  expanded = false,
  marginTopOnTurn,
  durationMs,
  reasoningTokens,
  isSelected = false,
  onClick,
}: {
  thinking: string
  streaming?: boolean
  expanded?: boolean
  marginTopOnTurn: boolean
  durationMs?: number
  reasoningTokens?: number
  isSelected?: boolean
  onClick?(event: ClickEvent): void
}): React.ReactNode {
  const [ref, time] = useAnimationFrame(streaming ? BREATH_TICK_MS : null)
  const [hovered, setHovered] = React.useState(false)
  if (thinking === '' && reasoningTokens === undefined) return null

  const theme = getTheme()
  const base = parseRGB(theme.activity) ?? { r: 125, g: 161, b: 222 }
  const highlight = parseRGB(theme.activityShimmer) ?? base
  const pulse = (Math.sin((time / BREATH_PERIOD_MS) * Math.PI * 2) + 1) / 2
  const rgb = interpolateColor(base, highlight, pulse)
  const dotColor = toRGBColor(rgb)
  const label = streaming ? t('thinking-label') : t('thought-label')
  const duration = durationMs === undefined ? '' : ` · ${durationMs < 1000 ? '<1s' : formatDuration(durationMs)}`
  const tokens = duration === '' && reasoningTokens !== undefined ? ` · ~${formatTokens(reasoningTokens)} tokens` : ''
  const clickable = thinking !== ''
  const click = (event: ClickEvent): void => {
    if (event.cellIsBlank) return
    onClick?.(event)
  }
  const hoverProps = clickable
    ? {
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
      }
    : {}

  return (
    <Box
      ref={ref as (element: DOMElement | null) => void}
      flexDirection="column"
      marginTop={marginTopOnTurn ? 1 : 0}
      paddingLeft={3}
      width="100%"
      backgroundColor={isSelected ? 'messageActionsBackground' : undefined}
      onClick={clickable ? click : undefined}
      {...hoverProps}
    >
      <Box flexDirection="row" width="100%" minWidth={0}>
        <Box width={2} flexShrink={0}>
          <Text color={dotColor} bold>●</Text>
        </Box>
        <Box flexGrow={1} minWidth={0}>
          <Text color={hovered && clickable ? 'text' : undefined} dimColor={!hovered}>
            {label}
            <Text dimColor>{duration}{tokens}</Text>
          </Text>
        </Box>
        {clickable && (
          <Box width={2} flexShrink={0}>
            <Text dimColor>{hovered ? (expanded ? '▴' : '▾') : ' '}</Text>
          </Box>
        )}
      </Box>
      {expanded && thinking !== '' && (
        <Box paddingLeft={2} marginTop={1}>
          <StreamingMarkdown dimColor>{thinking}</StreamingMarkdown>
        </Box>
      )}
    </Box>
  )
}
