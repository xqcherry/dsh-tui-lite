import React from 'react'
import type { Color } from '../../ink/styles.js'
import { stringWidth } from '../../utils/stringWidth.js'
import { Box, Text } from '../primitives.js'
import type { Theme } from '../theme.js'

/** A static chip on the top border row used for the session label. */
export interface InputBorderLabel {
  /** Visible text (already width-truncated by the caller). */
  text: string
  /** Chip background (theme token or raw color). */
  color: keyof Theme | Color
  /** Chip foreground (theme token or raw color). */
  ink: keyof Theme | Color
}

/** 边框行（顶/底共用同一色段序列——同步变色）。顶行可在右圆角前插入
 *  一个静态标签 chip（会话名），占用的列数从色段序列里扣掉，行宽不变。 */
function BorderRow({
  left,
  right,
  runs,
  idleColor,
  label,
}: {
  left: string
  right: string
  runs: ReadonlyArray<{ glyph: string; color: keyof Theme | Color }>
  idleColor: keyof Theme | Color
  label?: InputBorderLabel
}): React.ReactNode {
  const labelWidth = label === undefined ? 0 : stringWidth(` ${label.text} `)
  // chip 与右圆角之间的留白（边框线格数）：视觉上不让标签贴死 ╮。
  const labelGap = label === undefined ? 0 : 2
  // 裁剪色段序列到剩余列数（label 行与底行的列数一致，总宽不变）。
  // 色段保留左侧部分，右侧让位给 chip + 留白（右上角布局）。
  let budget = Math.max(0, runs.reduce((sum, run) => sum + run.glyph.length, 0) - labelWidth - labelGap)
  const clipped: Array<{ glyph: string; color: keyof Theme | Color }> = []
  for (const run of runs) {
    if (budget <= 0) break
    const take = Math.min(run.glyph.length, budget)
    if (take > 0) clipped.push({ glyph: run.glyph.slice(0, take), color: run.color })
    budget -= take
  }
  return (
    <Box width="100%" height={1} flexShrink={0} overflow="hidden">
      <Text wrap="truncate-end">
        <Text color={idleColor}>{left}</Text>
        {clipped.map((run, i) => (
          <Text key={i} color={run.color}>
            {run.glyph}
          </Text>
        ))}
        {label !== undefined && (
          <Text backgroundColor={label.color} color={label.ink}>{` ${label.text} `}</Text>
        )}
        {label !== undefined && <Text color={idleColor}>{'─'.repeat(labelGap)}</Text>}
        <Text color={idleColor}>{right}</Text>
      </Text>
    </Box>
  )
}

export function EffortInputBorder({
  effort,
  levels,
  columns,
  idleColor,
  topRightLabel,
  children,
}: {
  /** 当前思考强度档 id；`undefined` 表示路线未声明。 */
  effort: string | undefined
  /** 当前路线的档位表（低→高，末位为最高档）；未知时传 `undefined`。 */
  levels: readonly string[] | undefined
  columns: number
  /** 静止边框色（主题 token 名，如 'promptBorder' / 'planMode'）。 */
  idleColor: keyof Theme | Color
  /** 顶边框右侧的静态标签 chip（会话名标签）；undefined = 不显示。 */
  topRightLabel?: InputBorderLabel
  children: React.ReactNode
}): React.ReactNode {
  const runs = [{ glyph: '─'.repeat(Math.max(0, columns - 2)), color: idleColor }]

  return (
    <Box
      flexDirection="column"
      alignItems="flex-start"
      justifyContent="flex-start"
      width="100%"
      flexShrink={0}
    >
      <BorderRow left="╭" right="╮" runs={runs} idleColor={idleColor} label={topRightLabel} />
      <Box flexShrink={0}>{children}</Box>
      <BorderRow left="╰" right="╯" runs={runs} idleColor={idleColor} />
    </Box>
  )
}
