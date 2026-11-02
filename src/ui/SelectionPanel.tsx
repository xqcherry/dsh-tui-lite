import React from 'react'
import { Box, Text, useTerminalSize } from './primitives.js'

/** Shared frame for command menus, questionnaires and provider editors. */
export function SelectionPanel({ title, children, footer }: {
  title: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}): React.ReactNode {
  const { rows } = useTerminalSize()
  const spacing = rows < 18 ? 0 : 1
  return <Box flexDirection="column" width="100%" flexShrink={0} borderStyle="round" borderColor="permission" paddingX={1} marginTop={spacing}>
    <Box flexDirection="column" flexShrink={0}>
      {typeof title === 'string' ? <Text color="permission" bold wrap="truncate-end">{title}</Text> : title}
    </Box>
    <Box flexDirection="column" minWidth={0} marginTop={spacing}>{children}</Box>
    {footer !== undefined && <Box flexDirection="column" minWidth={0} marginTop={spacing}>{footer}</Box>}
  </Box>
}
