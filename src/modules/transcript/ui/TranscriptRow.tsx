import React from 'react'
import type { ClickEvent } from '../../../ink/events/click-event.js'
import type { DOMElement } from '../../../ink/dom.js'
import type { ChatRow } from '../../../shared/protocol/transcript.js'
import { t } from '../../../shared/i18n.js'
import { stripNarration } from '../../../shared/platform/narration.js'
import { stringWidth } from '../../../shared/platform/stringWidth.js'
import { truncateToWidth } from '../../../ink/truncateToWidth.js'
import { Box, Text } from '../../../ui/primitives.js'
import { Divider } from '../../../ui/design-system/Divider.js'
import { MessageMetadata } from './MessageMetadata.js'
import { TurnInterruptedRow } from './TurnInterruptedRow.js'
import { TranscriptImages } from './TranscriptImages.js'
import { AssistantTextMessage } from './AssistantTextMessage.js'
import { AssistantThinkingMessage } from './AssistantThinkingMessage.js'
import { UserPromptMessage } from './UserPromptMessage.js'
import { ToolEntryView } from './ToolEntryView.js'
import { displaySelectionPath } from './display-path.js'
import { subagentEntryOf, toolEntryOf } from '../model/tool-entry.js'

/**
 * One transcript row. Rows are intentionally flat: generated content uses
 * the OpenCode-style activity language (left indent, one-line tools, block
 * bodies only where output matters), while notices and local command output
 * keep their compact framed presentation.
 */
export type TranscriptRowProps = {
  row: ChatRow
  /** Primitive text snapshot so in-place streaming appends invalidate memo. */
  text: string
  /** Primitive revision for mutable tool/job/subagent objects. */
  revision: string
  expanded: boolean
  isRowExpanded: boolean
  isSelected: boolean
  marginTop: boolean
  model: string
  sessionCwd?: string
  onToggleRow(rowId: number): void
  setRowRef(rowId: number, el: DOMElement | null): void
}

function compactPreview(text: string, limit = 64): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return stringWidth(flat) <= limit ? flat : `${truncateToWidth(flat, limit - 1)}…`
}

function useRowRef(rowId: number, setRowRef: (rowId: number, el: DOMElement | null) => void): (el: DOMElement | null) => void {
  return React.useCallback((el: DOMElement | null) => {
    setRowRef(rowId, el)
  }, [rowId, setRowRef])
}

function toggleOnClick(onToggle: () => void): (event: ClickEvent) => void {
  return (event: ClickEvent) => {
    if (event.cellIsBlank) return
    onToggle()
  }
}

/**
 * Memoized row. `revision` is deliberately part of the prop set: the
 * channel mutates tool/job/subagent objects in place, so object identity
 * alone cannot tell React that a running row advanced.
 */
export function TranscriptRow({
  row,
  text,
  revision,
  expanded,
  isRowExpanded,
  isSelected,
  marginTop,
  model,
  sessionCwd,
  onToggleRow,
  setRowRef,
}: TranscriptRowProps): React.ReactNode {
  void revision
  const ref = useRowRef(row.id, setRowRef)
  const open = expanded || isRowExpanded || row.thinkingOpen === true
  const toggle = React.useCallback(() => onToggleRow(row.id), [onToggleRow, row.id])
  const onClick = toggleOnClick(toggle)
  const marginTopOnTurn = marginTop

  switch (row.kind) {
    case 'user':
      return (
        <Box flexDirection="column" ref={ref} width="100%">
          {row.selectionAttached !== undefined && (
            <Box paddingLeft={3}>
              <Text dimColor>
                {'⧉ '}{t('selection-attached', {
                  lines: row.selectionAttached.lines,
                  count: row.selectionAttached.lines,
                  path: displaySelectionPath(row.selectionAttached.path, sessionCwd),
                })}
              </Text>
            </Box>
          )}
          <UserPromptMessage
            text={text}
            marginTopOnTurn={marginTopOnTurn}
            isSelected={isSelected}
          />
          {row.images !== undefined && (
            <Box paddingLeft={3}>
              <TranscriptImages images={row.images} />
            </Box>
          )}
        </Box>
      )
    case 'assistant':
      return (
        <Box flexDirection="column" ref={ref} width="100%">
          <AssistantTextMessage
            text={stripNarration(text)}
            marginTopOnTurn={marginTopOnTurn}
            streaming={row.streaming === true}
            isSelected={isSelected}
          />
          {row.images !== undefined && (
            <Box paddingLeft={3}>
              <TranscriptImages images={row.images} />
            </Box>
          )}
          {open && row.time !== undefined && (
            <Box paddingLeft={3} marginTop={1}>
              <MessageMetadata timestamp={row.time} model={model} />
            </Box>
          )}
        </Box>
      )
    case 'reasoning':
      return (
        <Box ref={ref} width="100%">
          <AssistantThinkingMessage
            thinking={text}
            streaming={row.streaming === true}
            expanded={open}
            marginTopOnTurn={marginTopOnTurn}
            durationMs={row.durationMs}
            reasoningTokens={row.reasoningTokens}
            isSelected={isSelected}
            onClick={onClick}
          />
        </Box>
      )
    case 'tool': {
      if (row.tool === undefined) return null
      const entry = toolEntryOf(row.tool, { expanded: open })
      return (
        <Box ref={ref} width="100%">
          <ToolEntryView
            entry={entry}
            expanded={open}
            marginTop={marginTopOnTurn}
            onToggle={toggle}
          />
        </Box>
      )
    }
    case 'subagent': {
      if (row.subagent === undefined) return null
      const entry = subagentEntryOf(row.subagent)
      return (
        <Box ref={ref} width="100%">
          <ToolEntryView
            entry={entry}
            expanded={open}
            marginTop={marginTopOnTurn}
            onToggle={toggle}
          />
        </Box>
      )
    }
    case 'notice':
      return (
        <Box ref={ref} marginTop={1} width="100%">
          <Divider title={` ${text} `} />
        </Box>
      )
    case 'interrupt':
      return (
        <Box ref={ref} marginTop={1} width="100%">
          <TurnInterruptedRow />
        </Box>
      )
    case 'turn-summary':
      return null
    case 'compact':
      return (
        <Box
          ref={ref}
          marginTop={marginTopOnTurn ? 1 : 0}
          paddingLeft={3}
          width="100%"
          backgroundColor={isSelected ? 'messageActionsBackground' : undefined}
          onClick={onClick}
        >
          {open
            ? <Text dimColor wrap="wrap">{text}</Text>
            : <Text dimColor italic wrap="truncate-end">
                {'∴ '}{t('compact-summary-folded')} · {compactPreview(text)}
              </Text>}
        </Box>
      )
    case 'local':
      if (row.commandResult !== undefined) {
        const starts = row.commandResult === 'start' || row.commandResult === 'only'
        const ends = row.commandResult === 'end' || row.commandResult === 'only'
        return (
          <Box
            ref={ref}
            flexDirection="column"
            width="100%"
            flexShrink={0}
            marginTop={starts ? 1 : 0}
            paddingX={1}
            borderStyle="single"
            borderColor="permission"
            borderTop={starts}
            borderBottom={ends}
            borderLeft
            borderRight
          >
            <Text color="permission" bold wrap="truncate-end">{text}</Text>
          </Box>
        )
      }
      return (
        <Box ref={ref} marginTop={1} paddingLeft={2} backgroundColor={isSelected ? 'messageActionsBackground' : undefined} onClick={onClick}>
          <Text color="bashBorder">{'! '}{row.executionTarget === undefined ? '' : `[${row.executionTarget}] `}{text}</Text>
        </Box>
      )
    case 'local-output':
      if (row.commandResult !== undefined) {
        const ends = row.commandResult === 'end' || row.commandResult === 'only'
        return (
          <Box
            ref={ref}
            width="100%"
            flexShrink={0}
            paddingX={1}
            borderStyle="single"
            borderColor="permission"
            borderTop={false}
            borderBottom={ends}
            borderLeft
            borderRight
          >
            <Text dimColor={row.emphasis !== true} wrap="wrap">{text}</Text>
          </Box>
        )
      }
      return (
        <Box ref={ref} paddingLeft={3} onClick={onClick}>
          <Text dimColor={row.emphasis !== true} wrap="wrap">{text}</Text>
        </Box>
      )
  }
}

export const MemoRow = React.memo(TranscriptRow)
