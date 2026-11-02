import React from 'react'
import type { ToolGroupRow } from '../../../shared/protocol/transcript.js'
import { t } from '../../../shared/i18n.js'
import { toolDisplayName } from '../../../shared/platform/tool-name.js'
import { Box, Text } from '../../../ui/primitives.js'
import { formatDuration } from '../../../ui/text/format.js'

/**
 * Header line of a settled run of the same shell/job tool:
 *
 *   ▸ Bash ×8 · 1 failed · 12.3s · click to expand
 *
 * A folded summary is the whole group; clicking (or Ctrl+O) expands the
 * member cards. Failures stay loud while folded.
 */
export function ToolGroupHeader({ group, onToggle }: {
  group: ToolGroupRow
  onToggle?(): void
}): React.ReactNode {
  const [hovered, setHovered] = React.useState(false)
  const clickable = onToggle !== undefined
  const name = toolDisplayName(group.name)
  const duration = formatDuration(Math.max(0, group.endedAt - group.startedAt))
  const hint = group.folded
    ? t('tool-group-hint-expand')
    : hovered && clickable ? t('tool-group-hint-fold') : undefined
  return (
    <Box
      flexDirection="row"
      gap={1}
      onClick={onToggle}
      onMouseEnter={clickable ? (): void => setHovered(true) : undefined}
      onMouseLeave={clickable ? (): void => setHovered(false) : undefined}
    >
      <Text color={hovered && clickable ? 'accent' : 'inactive'}>{group.folded ? '▸' : '▾'}</Text>
      <Text wrap="truncate-end" color={hovered && clickable ? 'text' : undefined} dimColor={!(hovered && clickable)}>
        {t('tool-group-title', { name, count: group.count })}
      </Text>
      {group.failed > 0 && (
        <>
          <Text color="inactive">·</Text>
          <Text color="error">{t('tool-group-failed', { count: group.failed })}</Text>
        </>
      )}
      {duration !== '0s' && (
        <>
          <Text color="inactive">·</Text>
          <Text dimColor>{duration}</Text>
        </>
      )}
      {hint !== undefined && (
        <>
          <Text color="inactive">·</Text>
          <Text color={group.folded ? 'inactive' : 'accent'}>{hint}</Text>
        </>
      )}
    </Box>
  )
}
