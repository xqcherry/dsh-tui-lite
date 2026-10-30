import React from 'react'
import { Text } from '../ui.js'

/** Stable composer prefix; working state only dims it. */
export function EffortChargeGlyph({ working }: {
  effort: string | undefined
  levels: readonly string[] | undefined
  working: boolean
}): React.ReactNode {
  return <Text dimColor={working}>❯ </Text>
}
