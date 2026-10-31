import React from 'react'
import { stringWidth } from '../../../shared/platform/stringWidth.js'
import { Text } from '../../../ui/primitives.js'

/** The active reasoning level remains visible while the composer is empty. */
export function EffortTierBadge({ effort, columns, leadingColumns }: {
  effort: string | undefined
  levels: readonly string[] | undefined
  columns: number
  leadingColumns: number
}): React.ReactNode {
  if (effort === undefined) return null
  const label = effort.toUpperCase()
  const available = Math.max(0, columns - leadingColumns)
  if (stringWidth(label) + 1 > available) return null
  return <Text dimColor wrap="truncate-end">{` ${label}`}</Text>
}
