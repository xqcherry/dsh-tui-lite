import React from 'react'
import type { SubagentRow } from '../../../shared/protocol/subagents.js'
import { t } from '../../../shared/i18n.js'
import type { ClickEvent } from '../../../ink/events/click-event.js'
import { stringWidth } from '../../../shared/platform/stringWidth.js'
import { isMinimalUiMode } from '../../../ui/minimalUiMode.js'
import { Box, Text, useTerminalSize } from '../../../ui/primitives.js'
import type { Theme } from '../../../ui/theme.js'
import { toolNameColor } from '../../../ui/tool-colors.js'

/** The waterfall window is a Kimi Code style constant-height region. */
const WATERFALL_ROWS = 3
/** Card left padding + the `│ ` gutter prefix. */
const WATERFALL_GUTTER = 4

function duration(ms = 0): string {
  const seconds = Math.floor(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`
}
function tokens(row: SubagentRow): string {
  const total = row.tokens?.total ?? ((row.tokens?.input ?? 0) + (row.tokens?.output ?? 0) || 0)
  return total > 0 ? `${total} tok` : '- tok'
}
function status(row: SubagentRow): { glyph: string; label: string; color: keyof Theme | undefined } {
  const minimalUi = isMinimalUiMode()
  if (row.status === 'completed') return { glyph: minimalUi ? '✓' : '🟢', label: t('subagent-status-completed'), color: minimalUi ? undefined : 'success' }
  if (row.status === 'failed') return { glyph: minimalUi ? '×' : '🔴', label: t('subagent-status-failed'), color: minimalUi ? undefined : 'error' }
  if (row.status === 'cancelled') return { glyph: minimalUi ? '×' : '🔴', label: t('subagent-status-cancelled'), color: minimalUi ? undefined : 'error' }
  // No end was ever reported (the run's process is gone): settled, unknown.
  if (row.status === 'unknown') return { glyph: minimalUi ? '·' : '⚪', label: t('subagent-status-unknown'), color: minimalUi ? undefined : 'subtle' }
  return { glyph: minimalUi ? '·' : '🟡', label: t('subagent-status-running'), color: minimalUi ? undefined : 'warning' }
}
/** Hard single-line clip by display width — a wrapped waterfall row would
 * break the constant-height window. */
function clipLine(text: string, maxWidth: number): string {
  if (maxWidth <= 1) return ''
  let width = 0
  let index = 0
  while (index < text.length) {
    // Advance by the next full code point so wide glyphs (CJK, emoji) are
    // never split in half.
    const next = text.codePointAt(index)!
    const char = String.fromCodePoint(next)
    const charWidth = stringWidth(char)
    if (width + charWidth > maxWidth - 1) break
    width += charWidth
    index += char.length
  }
  return index < text.length ? `${text.slice(0, index)}…` : text
}

/**
 * Borderless, fixed-height activity card embedded directly in the transcript
 * (Kimi Code visual language). Running: header + one-line current tool + a
 * constant 3-row waterfall (each row hard-clipped to one terminal line so
 * the card height never changes). Settled: folds to the header line alone
 * (failure keeps one error line). The running glyph reuses the user's
 * working-activity preset (`/activity`), so the indicator follows the same
 * setting as the main spinner.
 */
export function SubagentMessage({ subagent, marginTopOnTurn, onClick, onOpenView }: {
  subagent: SubagentRow
  marginTopOnTurn: boolean
  isExpanded: boolean
  onClick?(event: ClickEvent): void
  /** 在主屏打开子代理转录：与卡片点击（→ 详情）并列的独立动作；拦截冒泡，
   *  普通正文点击与选区不受影响。 */
  onOpenView?(): void
}): React.ReactNode {
  const settled = subagent.status === 'completed' || subagent.status === 'failed' || subagent.status === 'cancelled' || subagent.status === 'unknown'
  const { columns } = useTerminalSize()
  const info = status(subagent)
  const [hovered, setHovered] = React.useState(false)
  const clickable = onClick !== undefined
  const elapsed = subagent.completedAt ? subagent.durationMs : Date.now() - subagent.startedAt
  const lastRunning = [...subagent.toolCalls].reverse().find(tool => tool.status === 'running')
  const previousDone = lastRunning
    ? subagent.toolCalls[subagent.toolCalls.indexOf(lastRunning) - 1]
    : subagent.toolCalls[subagent.toolCalls.length - 1]
  const activity = settled ? [] : subagent.outputLines.slice(-WATERFALL_ROWS)
  const rowWidth = Math.max(20, (columns ?? 80) - WATERFALL_GUTTER)

  // 点击打开详情场景；hover 不刷整行背景（转录视觉保持安静），只把状态
  // glyph 提亮为品牌色作为可点指示。
  return <Box
    flexDirection="column"
    marginTop={marginTopOnTurn ? 1 : 0}
    paddingLeft={2}
    onClick={onClick}
    onMouseEnter={clickable ? () => setHovered(true) : undefined}
    onMouseLeave={clickable ? () => setHovered(false) : undefined}
  >
    <Box flexDirection="row" gap={1}>
      <Text color={hovered && clickable ? 'accent' : info.color}>{info.glyph}</Text>
      <Text bold color={hovered && clickable ? 'accent' : undefined}>{`${t('subagent-card-prefix')}${subagent.description}`}</Text>
      <Text dimColor>·</Text><Text>{subagent.model ?? subagent.provider ?? 'default'}</Text>
      {subagent.effort && <><Text dimColor>·</Text><Text dimColor>{subagent.effort}</Text></>}
      <Text dimColor>·</Text><Text dimColor>{duration(elapsed)}</Text>
      <Text dimColor>·</Text><Text dimColor>{tokens(subagent)}</Text>
      <Text dimColor>·</Text><Text dimColor>{subagent.toolCalls.length} tools</Text>
      <Text dimColor>·</Text><Text color={info.color}>{info.label}</Text>
      {onOpenView !== undefined && (
        <Box
          flexShrink={0}
          marginLeft={1}
          onClick={(event: ClickEvent) => {
            // 拦截冒泡：这一格是「主屏查看」，不是卡片点击（→详情）。
            event.stopImmediatePropagation()
            onOpenView()
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* 字形位（与面板 ⤢ 全屏同一词汇）：卡片行是恒定高度的水流行，
              长标签会把状态列顶折行；完整名称留给 Dashboard/Detail 入口。 */}
          <Text color={hovered ? 'accent' : 'subtle'}>{'⤢'}</Text>
        </Box>
      )}
    </Box>
    {!settled && (lastRunning ?? previousDone) !== undefined && (
      <Text wrap="truncate">
        {lastRunning !== undefined ? (
          <>
            {previousDone !== undefined && (
              <>
                <Text dimColor>{'  · '}</Text>
                <Text color="success">✓</Text>
                <Text color={toolNameColor(previousDone.name)}>{previousDone.name}</Text>
                <Text dimColor>{' · '}</Text>
              </>
            )}
            {lastRunning.argsPreview === undefined && (
              <Text color={toolNameColor(lastRunning.name)}>{lastRunning.name}</Text>
            )}
            {lastRunning.argsPreview !== undefined && (
              <>
                <Text color={toolNameColor(lastRunning.name)}>{lastRunning.name}</Text>
                <Text dimColor>{` (${clipLine(lastRunning.argsPreview.replace(/\s+/g, ' ').trim(), Math.max(10, rowWidth - lastRunning.name.length - 6))})`}</Text>
              </>
            )}
          </>
        ) : (
          previousDone !== undefined && (
            <>
              <Text dimColor>{'  · '}</Text>
              <Text color="success">✓</Text>
              <Text color={toolNameColor(previousDone.name)}>{previousDone.name}</Text>
              {previousDone.argsPreview !== undefined && (
                <Text dimColor>{` (${clipLine(previousDone.argsPreview.replace(/\s+/g, ' ').trim(), Math.max(10, rowWidth - previousDone.name.length - 6))})`}</Text>
              )}
            </>
          )
        )}
      </Text>
    )}
    {!settled && Array.from({ length: WATERFALL_ROWS }, (_, index) => (
      // key 不含 time：含 time 的 key 让每个 animation tick 都变成
      // unmount+mount，DOMElement/Yoga node churn 且 nodeCache 失配扩大
      // terminal damage。内容更新走 in-place diff。
      <Text key={`${subagent.agentId}-wf-${index}`} dimColor wrap="truncate">{`  │ ${clipLine(activity[index] ?? '', rowWidth)}`}</Text>
    ))}
    {settled && subagent.status === 'failed' && subagent.error && (
      <Text color="error" wrap="truncate">{`  └ ${clipLine(subagent.error, rowWidth)}`}</Text>
    )}
  </Box>
}
