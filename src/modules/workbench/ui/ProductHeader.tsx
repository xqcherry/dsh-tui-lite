import React from 'react'
import { Box, Text, useAnimationFrame, useTerminalSize } from '../../../ui/primitives.js'
import { getWhalePixels, WHALE_PALETTE } from './whale-frames.js'
import { formatTokens } from '../../../ui/text/format.js'

export interface ProductHeaderProps {
  readonly model: string
  readonly cwd: string
  readonly backendVersion?: string
  readonly provider?: string
  readonly contextWindow?: number
}

function Whale(): React.ReactNode {
  const [ref, time] = useAnimationFrame(100)
  const startedAt = React.useRef(time)
  const pixels = getWhalePixels(time - startedAt.current)
  return <Box ref={ref} width={12} height={4} flexShrink={0} flexDirection="column">
    {[0, 2, 4, 6].map(y => <Text key={y} wrap="truncate-end">
      {Array.from({ length: 12 }, (_, x) => {
        const upper = WHALE_PALETTE[pixels[y][x]]
        const lower = WHALE_PALETTE[pixels[y + 1][x]]
        return <Text key={x} color={upper ?? lower} backgroundColor={upper ? lower : undefined}>
          {upper ? '▀' : lower ? '▄' : ' '}
        </Text>
      })}
    </Text>)}
  </Box>
}

/** UI-only introduction; ordinary inline layout lets it enter scrollback. */
export function ProductHeader({ model, cwd, backendVersion, provider, contextWindow }: ProductHeaderProps): React.ReactNode {
  const { columns } = useTerminalSize()
  const stacked = columns < 40
  const width = Math.max(1, columns - (stacked ? 0 : 14))
  const capacity = contextWindow !== undefined && Number.isFinite(contextWindow) && contextWindow > 0
    ? `[${formatTokens(contextWindow)}]` : ''
  return <Box flexDirection={stacked ? 'column' : 'row'} columnGap={2} marginBottom={1} flexShrink={0}>
    <Whale />
    <Box width={width} flexShrink={0} flexDirection="column" marginTop={stacked ? 0 : 1}>
      <Text wrap="truncate-end"><Text bold color="#0066ff">DSH</Text>{backendVersion ? <Text dimColor>{` v${backendVersion}`}</Text> : null}</Text>
      <Text wrap="truncate-end">
        {model || 'No model configured'}{model ? capacity : ''}
        {model && provider ? <Text dimColor>{` · ${provider}`}</Text> : null}
      </Text>
      <Text dimColor wrap="truncate-end">{cwd}</Text>
    </Box>
  </Box>
}
