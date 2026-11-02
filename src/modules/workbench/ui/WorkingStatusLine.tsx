import chalk from 'chalk'
import React from 'react'
import { t } from '../../../shared/i18n.js'
import type { SpinnerMode } from '../../../shared/protocol/display.js'
import { formatDuration } from '../../../ui/text/format.js'
import { BLACK_CIRCLE } from '../../../ui/text/figures.js'
import { isMinimalUiMode } from '../../../ui/minimalUiMode.js'
import { interpolateColor, parseRGB } from '../../../ui/Spinner/spinnerUtils.js'
import { getTheme } from '../../../ui/theme.js'
import { Box, Text, useAnimationFrame } from '../../../ui/primitives.js'

/** One breath (dim → bright → dim) of the leading activity dot. */
const BREATH_PERIOD_MS = 1800
/** Animation cadence: smooth enough for a sine pulse, cheap enough to redraw. */
const BREATH_TICK_MS = 80

export interface WorkingStatusLineProps {
  /** Only a running turn owns this row; idle renders nothing. */
  readonly working: boolean
  /** Stage of the current turn; drives the label. */
  readonly spinnerMode: SpinnerMode | undefined
  /** Wall clock the current turn began (0 when unknown). */
  readonly turnStart: number
  /** Tools running in parallel, used when no single tool name is known. */
  readonly activeToolCount: number
  /** Friendly name of the running tool, when one can be named. */
  readonly toolName?: string
  /** Clock seam for the elapsed label. */
  readonly now?: () => number
}

/** Current phase as a short status phrase, never an invented assistant state. */
function activityLabel(mode: SpinnerMode | undefined, toolName: string | undefined, activeToolCount: number): string {
  switch (mode) {
    case 'thinking':
      return t('working-thinking')
    case 'responding':
      return t('working-responding')
    case 'tool-input':
      return t('working-tool-input')
    case 'tool-use': {
      const tool = toolName?.replace(/\s+/g, ' ').trim()
      if (tool) return t('working-tool', { tool })
      if (activeToolCount > 0) return t('working-tools', { count: activeToolCount })
      return t('working-tool-generic')
    }
    case 'requesting':
      return t('working-requesting')
    default:
      return t('working-generic')
  }
}

/**
 * One line above the composer while a turn runs: a breathing activity dot,
 * the current phase and the turn's elapsed time. The dot pulses between the
 * theme's activity pair, so a long silent request reads as alive instead of a
 * frozen screen. Idle (and an open panel) renders nothing: the row is not
 * reserved, so the composer keeps its usual spacing.
 */
export function WorkingStatusLine({
  working,
  spinnerMode,
  turnStart,
  activeToolCount,
  toolName,
  now = Date.now,
}: WorkingStatusLineProps): React.ReactNode {
  const [ref, time] = useAnimationFrame(working ? BREATH_TICK_MS : null)
  if (!working) return null

  const theme = getTheme()
  const minimalUi = isMinimalUiMode()
  const base = parseRGB(theme.activity) ?? { r: 125, g: 161, b: 222 }
  const highlight = parseRGB(theme.activityShimmer) ?? base
  const pulse = (Math.sin((time / BREATH_PERIOD_MS) * Math.PI * 2) + 1) / 2
  const rgb = interpolateColor(base, highlight, pulse)
  const dot = minimalUi
    ? BLACK_CIRCLE
    : chalk.rgb(rgb.r, rgb.g, rgb.b).bold(BLACK_CIRCLE)
  const elapsed = turnStart > 0 ? formatDuration(Math.max(0, now() - turnStart)) : ''
  const label = activityLabel(spinnerMode, toolName, activeToolCount)

  return <Box ref={ref} height={1} flexShrink={0} overflow="hidden" paddingLeft={1} paddingRight={1}>
    <Text wrap="truncate-end">
      {dot}
      {` ${label}`}
      {elapsed !== '' ? <Text dimColor>{` · ${elapsed}`}</Text> : null}
    </Text>
  </Box>
}
