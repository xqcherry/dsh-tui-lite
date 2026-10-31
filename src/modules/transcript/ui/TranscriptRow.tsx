import React, { useState } from 'react'
import type { TranscriptImage } from '../../../shared/protocol/composer.js'
import type { JobGroupRow, JobRow } from '../../../shared/protocol/jobs.js'
import type { SubagentRow } from '../../../shared/protocol/subagents.js'
import type { ChatRow, ToolCallView, ToolResultView, ToolRow } from '../../../shared/protocol/transcript.js'
import { t } from '../../../shared/i18n.js'
import type { ToolBackground } from '../../../shared/platform/display-preferences.js'

import type { DOMElement } from '../../../ink/dom.js'
import type { ClickEvent } from '../../../ink/events/click-event.js'


import { truncateToWidth } from '../../../ink/truncateToWidth.js'
import { foldLongLines } from '../../../ui/text/fold-long-lines.js'
import { primaryComboString } from '../../../shared/platform/keymap.js'
import { stripNarration } from '../../../shared/platform/narration.js'
import { stringWidth } from '../../../shared/platform/stringWidth.js'

import { Box, Text } from '../../../ui/primitives.js'
import { JobCard } from '../../activity/index.js'
import { JobGroupHeader } from '../../activity/index.js'
import { SubagentMessage } from '../../activity/index.js'
import { StreamingMarkdown } from '../../../ui/StreamingMarkdown.js'
import { TurnInterruptedRow } from './TurnInterruptedRow.js'
import { Divider } from '../../../ui/design-system/Divider.js'
import { MessageMetadata } from './MessageMetadata.js'
import { TranscriptImages } from './TranscriptImages.js'
import { AssistantTextLeafRow, ThinkingLeafRow, ToolLeafRow } from './TranscriptLeaves.js'
import { UserPromptMessage } from './UserPromptMessage.js'


import { displaySelectionPath } from './list-signatures.js'


export type MemoRowProps = {
  rowId: number
  kind: ChatRow['kind']
  text: string
  images: readonly TranscriptImage[] | undefined
  /** Reasoning rows: the FULL un-revealed text — the live three-line preview
   *  ticker follows the newest arrived content (never the reveal), while the
   *  expanded body shows the revealed slice in `text`. */
  textFull?: string
  executionTarget: string | undefined
  /** IDE selection indicator (user rows): rendered above the prompt bubble. */
  selectionAttached: ChatRow['selectionAttached']
  /** Session cwd for the indicator's display-path relativization (T-FIX-01). */
  sessionCwd: string | undefined
  streaming: boolean
  thinkingOpen: boolean
  durationMs: number | undefined
  /** Estimated thinking tokens of a count-only reasoning row. */
  reasoningTokens: number | undefined
  time: number | undefined
  marginTopOnTurn: boolean
  isSelected: boolean
  isExpanded: boolean
  expanded: boolean
  model: string
  /** Edit/Write diff presentation preference (forwarded to tool cards). */
  diffLayout: 'auto' | 'split' | 'unified'
  /** Smooth streaming reveal (forwarded to thinking/tool renderers). */
  smoothStreaming: boolean
  /** Live-arrived row flag (drives tool-card reveal participation). */
  fresh: boolean
  /** Version tick for active tool reveal; 0 keeps settled rows memoized. */
  revealVersion: number
  thinkingFold: 'preview' | 'full'
  toolBackground: ToolBackground
  /** Terminal-card header folding (forwarded to tool cards). */
  foldTerminalCommand: boolean
  /** Working-activity preset name; drives the subagent card's running glyph. */
  background: 'messageActionsBackground' | undefined
  // ToolRow, flattened: the channel writes status/result fields in place,
  // so passing the object itself would make mutations invisible to memo.
  toolCallId: string | undefined
  toolName: string | undefined
  toolArgsText: string | undefined
  toolArgsFull: string | undefined
  toolStatus: ToolRow['status'] | undefined
  toolResultText: string | undefined
  toolResultFull: string | undefined
  toolErrorText: string | undefined
  /** Trajectory footnote, present on at most one row (the newest failure). */
  toolFootnote: string | undefined
  /** Presentation views are set-once stable refs (creation / settle), so a
   *  plain ref compare stays correct under the in-place mutation model. */
  toolCallView: ToolCallView | undefined
  toolResultView: ToolResultView | undefined
  toolStartedAt: number | undefined
  toolDurationMs: number | undefined
  /** Row-level source fold (window cap dropped full payloads): the expanded
   *  card discloses preview-only instead of passing it off as full text. */
  toolSourceFolded: boolean
  // SubagentRow, stable ref (subagent lifecycle events update the store, not
  // the row ref itself, so a plain ref compare stays correct).
  subagent: SubagentRow | undefined
  // JobRow, same update contract as SubagentRow (replaced per job commit).
  job: JobRow | undefined
  /** Group decoration for a run of consecutive job cards (see JobGroupRow). */
  jobGroup: JobGroupRow | undefined
  onToggleRow: (rowId: number) => void
  /** 流式 reasoning 行在三行预览/全文间切换；落定行用 onToggleRow。 */
  onToggleStreamView: (rowId: number) => void
  /** 是否反转该流式行的 thinkingFold 默认视图。 */
  streamViewToggled: boolean
  onOpenSubagent: ((agentId: string) => void) | undefined
  onOpenSubagentView: ((agentId: string, rowId: number) => void) | undefined
  onOpenJobs: ((focusId?: string) => void) | undefined
  onWatchJobOutput: ((id: string) => () => void) | undefined
  onOpenFile: ((path: string) => void) | undefined
  setRowRef: (rowId: number, el: DOMElement | null) => void
}

export function ClickableDivider({ title, onClick }: { title: string; onClick?: () => void }): React.ReactNode {
  const [hovered, setHovered] = useState(false)
  return (
    <Box
      marginTop={1}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      backgroundColor={hovered ? 'userMessageBackgroundHover' : undefined}
    >
      <Divider title={title} />
    </Box>
  )
}

export function TranscriptRow({
  rowId,
  kind,
  text,
  images,
  textFull,
  executionTarget,
  selectionAttached,
  sessionCwd,
  streaming,
  thinkingOpen,
  durationMs,
  reasoningTokens,
  time,
  marginTopOnTurn,
  isSelected,
  isExpanded,
  expanded,
  model,
  diffLayout,
  smoothStreaming,
  fresh,
  revealVersion,
  thinkingFold,
  toolBackground,
  foldTerminalCommand,
  background,
  toolCallId,
  toolName,
  toolArgsText,
  toolArgsFull,
  toolStatus,
  toolResultText,
  toolResultFull,
  toolErrorText,
  toolFootnote,
  toolCallView,
  toolResultView,
  toolStartedAt,
  toolDurationMs,
  toolSourceFolded,
  subagent,
  job,
  jobGroup,
  onToggleRow,
  onToggleStreamView,
  streamViewToggled,
  onOpenSubagent,
  onOpenSubagentView,
  onOpenJobs,
  onWatchJobOutput,
  onOpenFile,
  setRowRef,
}: MemoRowProps): React.ReactNode {
  const ref = React.useCallback(
    (el: DOMElement | null): void => {
      setRowRef(rowId, el)
    },
    [setRowRef, rowId],
  )
  // 可折叠行（工具卡/思考/compact 摘要）共用：点击切换展开，全宽行右侧
  // 空白（屏幕缓冲未写入单元格）不触发——点击空白想选字/拖拽时不再误触
  // 展开/收起（审计 C-03/cellIsBlank 零消费）。纯文本行（user/assistant）
  // 平时不可点：转录是阅读区（用户反馈），折叠语义留给带视觉指示的行——
  // 唯一例外是**被折叠的超长单行**：那时整行就是展开开关（见 foldClickable）。
  const foldOnClick = React.useCallback((event: ClickEvent): void => {
    if (event.cellIsBlank) return
    onToggleRow(rowId)
  }, [onToggleRow, rowId])
  // 当前回合仍展开的 reasoning 行：点击在三行预览/全文间切换。它反转
  // thinkingFold 的默认值，回合落定后语义自动回到 foldOnClick。
  const streamViewOnClick = React.useCallback((event: ClickEvent): void => {
    if (event.cellIsBlank) return
    onToggleStreamView(rowId)
  }, [onToggleStreamView, rowId])
  // 任务组：点击组头行折叠/展开整组（与工具卡的折叠同一套手势：行点击 =
  // expandedRows 切换，Ctrl+O 展开全部）。
  const toggleJobGroup = React.useCallback((): void => {
    onToggleRow(rowId)
  }, [onToggleRow, rowId])
  // 子代理卡：点击打开详情场景（不是折叠）。
  const openSubagent = React.useCallback(() => {
    if (subagent !== undefined) onOpenSubagent?.(subagent.agentId)
  }, [onOpenSubagent, subagent])
  // compact 摘要折叠行 hover 轻指示（∴ 提亮，不刷背景）。
  const [compactHovered, setCompactHovered] = useState(false)

  // Long single lines are clipped before layout (utils/fold-long-lines.ts):
  // one 300k-char paste or minified-JS line otherwise wraps into thousands of
  // visual rows and that per-frame wrap — not the row count — dominates the
  // frame. Ctrl+O (global) AND a row click (per-row, the same `expandedRows`
  // gesture message-selection mode uses) both paint the raw text again.
  // Reasoning rows are deliberately excluded: their preview is already a fixed
  // three-row ticker. Tool cards fold inside their own header/body
  // (AssistantToolUseMessage), whose text never rides this prop.
  const foldable = kind !== 'reasoning' && kind !== 'tool'
  const folded = React.useMemo(
    () => (foldable ? foldLongLines(text) : { text, hiddenChars: 0, foldedLines: 0 }),
    [foldable, text],
  )
  const displayText = expanded || isExpanded ? text : folded.text
  // Mouse toggle: only a row that ACTUALLY hides something is clickable (an
  // ordinary message stays inert so plain clicks and drag-selection keep
  // working there). A streaming row is clickable too — the same contract the
  // tool card has while running: the click paints the full ARRIVED text, and
  // the reveal keeps growing it.
  const foldClickable = foldable && folded.hiddenChars > 0

  switch (kind) {
    case 'user':
      return (
        <Box flexDirection="column" ref={ref} onClick={foldClickable ? foldOnClick : undefined}>
          {selectionAttached && (
            <Text dimColor>
              {'⧉ '}{t('selection-attached', {
                lines: selectionAttached.lines,
                count: selectionAttached.lines,
                path: displaySelectionPath(selectionAttached.path, sessionCwd),
              })}
            </Text>
          )}
          {text !== '' && (
            <UserPromptMessage
              text={displayText}
              marginTopOnTurn={marginTopOnTurn}
              isSelected={isSelected}
            />
          )}
          {images !== undefined && (
            <Box marginTop={text === '' && marginTopOnTurn ? 1 : 0}>
              <TranscriptImages images={images} />
            </Box>
          )}
        </Box>
      )
    case 'assistant':
      return streaming ? (
        <Box
          alignItems="flex-start"
          flexDirection="row"
          marginTop={marginTopOnTurn ? 1 : 0}
          width="100%"
          backgroundColor={background}
          ref={ref}
          onClick={foldClickable ? foldOnClick : undefined}
        >
          <Box minWidth={2}>
            <Text color="text">●</Text>
          </Box>
          <Box flexDirection="column">
            {/* The ⏵ self-narration line (working-activity narrate contract)
              is stripped here: the live working line on the status bar
              already shows it. */}
            <StreamingMarkdown>{stripNarration(displayText)}</StreamingMarkdown>
            {images !== undefined && <TranscriptImages images={images} indent={0} />}
          </Box>
        </Box>
      ) : (
        <Box
          width="100%"
          flexDirection="column"
          backgroundColor={background}
          ref={ref}
          onClick={foldClickable ? foldOnClick : undefined}
        >
          {expanded && (
            <Box
              flexDirection="row"
              justifyContent="flex-end"
              gap={1}
              marginTop={1}
            >
              <MessageMetadata timestamp={time} model={model} />
            </Box>
          )}
          <AssistantTextLeafRow
            text={stripNarration(displayText)}
            marginTopOnTurn={marginTopOnTurn}
            isSelected={isSelected}
            isExpanded={isExpanded}
          />
          {images !== undefined && <TranscriptImages images={images} />}
        </Box>
      )
    case 'reasoning': {
      // The setting chooses the live default; a row click reverses it. Global
      // or per-row transcript expansion always wins and shows the full text.
      const turnOpen = streaming || thinkingOpen
      const streamPreview = turnOpen && !expanded && !isExpanded &&
        (streamViewToggled ? thinkingFold === 'full' : thinkingFold === 'preview')
      return (
        <Box flexDirection="column" ref={ref}>
          <ThinkingLeafRow
            thinking={text}
            textFull={textFull}
            marginTopOnTurn={marginTopOnTurn}
            streaming={streaming}
            preview={streamPreview}
            // Settled rows keep the fold-on-settle default and expand via
            // expandedRows/Ctrl+O; a current-turn row is preview or full.
            verbose={isExpanded || expanded || (turnOpen && !streamPreview)}
            durationMs={durationMs}
            reasoningTokens={reasoningTokens}
            isSelected={isSelected}
            onClick={turnOpen ? streamViewOnClick : foldOnClick}
          />
        </Box>
      )
    }
    case 'tool': {
      if (
        toolCallId === undefined ||
        toolName === undefined ||
        toolArgsText === undefined ||
        toolStatus === undefined ||
        toolStartedAt === undefined
      ) {
        return null
      }
      // Rebuilt per render from the flattened props — cheap object literal,
      // and AssistantToolUseMessage is only reached when memo let us through.
      const tool: ToolRow = {
        callId: toolCallId,
        name: toolName,
        argsText: toolArgsText,
        argsFull: toolArgsFull,
        status: toolStatus,
        resultText: toolResultText,
        resultFull: toolResultFull,
        errorText: toolErrorText,
        callView: toolCallView,
        resultView: toolResultView,
        startedAt: toolStartedAt,
        durationMs: toolDurationMs,
      }
      return (
        <Box flexDirection="column" ref={ref}>
          <ToolLeafRow
            tool={tool}
            marginTopOnTurn={marginTopOnTurn}
            verbose={isExpanded || expanded}
            isSelected={isSelected}
            isExpanded={isExpanded}
            footnote={toolFootnote}
            diffLayout={diffLayout}
            toolBackground={toolBackground}
            smoothReveal={smoothStreaming}
            fresh={fresh}
            revealVersion={revealVersion}
            foldTerminalCommand={foldTerminalCommand}
            onClick={foldOnClick}
            onOpenFile={onOpenFile}
            images={images}
            sourceFolded={toolSourceFolded}
          />
        </Box>
      )
    }
    case 'notice':
      return (
        <Box marginTop={1} ref={ref} onClick={foldClickable ? foldOnClick : undefined}>
          <Divider title={` ${displayText} `} />
        </Box>
      )
    case 'interrupt':
      return (
        <Box marginTop={1} ref={ref}>
          <TurnInterruptedRow />
        </Box>
      )
    case 'turn-summary':
      return null
    case 'local':
      // `!` mode command echo.
      return (
        <Box marginTop={1} backgroundColor={background} ref={ref} onClick={foldClickable ? foldOnClick : undefined}>
          <Text color="bashBorder">!{executionTarget ? ` [${executionTarget}]` : ''} {displayText}</Text>
        </Box>
      )
    case 'local-output':
      return (
        <Box paddingLeft={2} backgroundColor={background} ref={ref} onClick={foldClickable ? foldOnClick : undefined}>
          <Text dimColor>{displayText}</Text>
        </Box>
      )
    case 'compact':
      // The post-compaction summary defaults to a folded one-liner with a
      // text preview; Ctrl+O (global), message-selection Enter, or a click
      // reveals the full summary.
      return (
        <Box
          marginTop={marginTopOnTurn ? 1 : 0}
          paddingLeft={2}
          backgroundColor={background}
          ref={ref}
          onClick={foldOnClick}
          onMouseEnter={() => setCompactHovered(true)}
          onMouseLeave={() => setCompactHovered(false)}
        >
          {expanded || isExpanded ? (
            <Text dimColor>{text}</Text>
          ) : (
            <Text dimColor italic color={compactHovered ? 'text' : undefined}>
              <Text color={compactHovered ? 'text' : undefined}>∴</Text>
              {' '}{t('compact-summary-folded')} · {compactPreview(displayText)}{' '}
              {t('hint-expand-ctrl-o', { key: primaryComboString('transcript') })}
            </Text>
          )}
        </Box>
      )
    case 'subagent':
      if (!subagent) return null
      return (
        <Box flexDirection="column" ref={ref}>
          <SubagentMessage
            subagent={subagent}
            marginTopOnTurn={marginTopOnTurn}
            isExpanded={isExpanded}
            onClick={openSubagent}
            onOpenView={onOpenSubagentView === undefined ? undefined : () => onOpenSubagentView(subagent.agentId, rowId)}
          />
        </Box>
      )
    case 'job': {
      if (!job) return null
      // A grouped run renders as ONE block: the head row carries the summary
      // line, members hang off the shared rail, and a FOLDED run keeps only
      // that summary (its members were dropped from the window upstream).
      const groupHead = jobGroup !== undefined && jobGroup.head
      return (
        <Box
          flexDirection="column"
          // The head's block margin moves UP to the group (the summary line
          // is what separates the run from what precedes it); the card under
          // it must not add a second blank line.
          marginTop={groupHead && marginTopOnTurn ? 1 : 0}
          ref={ref}
        >
          {groupHead && <JobGroupHeader group={jobGroup} onToggle={toggleJobGroup} />}
          {groupHead && jobGroup.folded ? null : (
            <JobCard
              job={job}
              expanded={isExpanded !== expanded}
              onToggle={toggleJobGroup}
              marginTopOnTurn={groupHead ? false : marginTopOnTurn}
              // Clicking a card opens the panel focused on THAT job, not the roster head.
              onClick={onOpenJobs === undefined ? undefined : () => onOpenJobs(job.id)}
              onWatchOutput={onWatchJobOutput}
            />
          )}
        </Box>
      )
    }
  }
}

export function compactPreview(text: string, limit = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return stringWidth(flat) <= limit ? flat : `${truncateToWidth(flat, limit - 1)}…`
}

export const MemoRow = React.memo(TranscriptRow)
