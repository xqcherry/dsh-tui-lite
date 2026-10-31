import React from 'react'
import type { TranscriptImage } from '../../../shared/protocol/composer.js'
import type { ToolRow } from '../../../shared/protocol/transcript.js'
import { t } from '../../../shared/i18n.js'
import type { ToolBackground } from '../../../shared/platform/display-preferences.js'
import type { ClickEvent } from '../../../ink/events/click-event.js'
import { Box, Text } from '../../../ui/primitives.js'

import { AssistantTextMessage } from './AssistantTextMessage.js'
import { AssistantThinkingMessage } from './AssistantThinkingMessage.js'
import { AssistantToolUseMessage } from './AssistantToolUseMessage.js'
import { TranscriptImages } from './TranscriptImages.js'
import type { AgentMessageVia, AgentMessageView } from '../../../shared/protocol/agent-team.js'

// ── agent↔agent message flow leaves ─────────────────────────────────────────

export { agentMessageStateColor, agentMessageStateText } from '../../../ui/agent-message-style.js'
import { agentMessageStateColor, agentMessageStateText } from '../../../ui/agent-message-style.js'

/** One endpoint's short label: `user`/`parent`/`child` for the relations the
 *  view itself proves (own id, parentSessionId), the stable short id for any
 *  other agent. Absent ids stay unnamed — the caller decides whether that is
 *  an unknown-relation row (no arrow). */
export function agentMessagePartyLabel(id: string | undefined, selfAgentId: string, parentSessionId?: string): string | undefined {
  if (id === undefined) return undefined
  if (id === 'user') return t('agent-message-source-user')
  if (id === selfAgentId) return t('agent-message-source-child')
  if (parentSessionId !== undefined && id === parentSessionId) return t('agent-message-source-parent')
  return id.length > 8 ? id.slice(0, 8) : id
}

/** The localized transport word. */
export function agentMessageViaText(via: AgentMessageVia): string {
  return t(`agent-message-via-${via}`)
}

/**
 * One agent↔agent message as a transcript leaf: a `⇄ from → to · state`
 * header plus an indented preview, paged together with the thinking/text/
 * tool leaves. Without both endpoints it shows the unknown-relation line
 * and no arrow.
 */
export function AgentMessageLeafRow({ message, selfAgentId, marginTopOnTurn }: {
  message: AgentMessageView
  /** This child's agent id — resolves `child` in the party labels. */
  selfAgentId: string
  marginTopOnTurn: boolean
}): React.ReactNode {
  const from = agentMessagePartyLabel(message.from, selfAgentId, message.parentSessionId)
  const to = agentMessagePartyLabel(message.to, selfAgentId, message.parentSessionId)
  const known = from !== undefined && to !== undefined
  const stateColor = agentMessageStateColor(message.state)
  return (
    <Box flexDirection="column" marginTop={marginTopOnTurn ? 1 : 0} paddingLeft={2}>
      <Box flexDirection="row" gap={1}>
        <Text color="accent">⇄</Text>
        {known ? (
          <Text dimColor wrap="truncate-end">{t('agent-message-from-to', { from, to })}</Text>
        ) : (
          <Text dimColor italic wrap="truncate-end">{t('agent-message-unknown-target')}</Text>
        )}
        <Text dimColor>·</Text>
        <Box flexShrink={0}><Text color={stateColor}>{agentMessageStateText(message.state)}</Text></Box>
        <Text dimColor>·</Text>
        <Text dimColor wrap="truncate-end">{agentMessageViaText(message.via)}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor wrap="wrap">{message.text}</Text>
      </Box>
      {message.state === 'unknown' && (
        <Box paddingLeft={2}>
          <Text dimColor italic>{t('agent-message-no-delivery-fact')}</Text>
        </Box>
      )}
    </Box>
  )
}

/**
 * Transcript leaf rows: the main MessageList and the subagent transcript
 * pages render thinking / tool / text rows through these thin adapters, so
 * a child transcript reads like the main one. Presentation only: fold
 * state, reveal cursors and row anchoring stay with the callers.
 */

/** A settled/live thinking row (`⚓ Thinking` preview or expanded body). */
export function ThinkingLeafRow({
  thinking,
  textFull,
  marginTopOnTurn,
  streaming = false,
  preview = false,
  verbose,
  durationMs,
  reasoningTokens,
  isSelected = false,
  onClick,
}: {
  thinking: string
  /** The full un-revealed text the live preview ticker follows. */
  textFull?: string
  marginTopOnTurn: boolean
  streaming?: boolean
  preview?: boolean
  verbose: boolean
  durationMs?: number
  /** Thinking reported only as a count (no body) — the one-line header. */
  reasoningTokens?: number
  isSelected?: boolean
  onClick?(event: ClickEvent): void
}): React.ReactNode {
  return (
    <AssistantThinkingMessage
      thinking={thinking}
      textFull={textFull}
      marginTopOnTurn={marginTopOnTurn}
      streaming={streaming}
      preview={preview}
      verbose={verbose}
      durationMs={durationMs}
      reasoningTokens={reasoningTokens}
      isSelected={isSelected}
      onClick={onClick}
    />
  )
}

/** A tool-call card (args / result / error / diff), optionally with images. */
export function ToolLeafRow({
  tool,
  marginTopOnTurn,
  verbose,
  isSelected = false,
  isExpanded = false,
  footnote,
  diffLayout,
  toolBackground,
  smoothReveal,
  fresh,
  revealVersion,
  foldTerminalCommand,
  onClick,
  onOpenFile,
  images,
  sourceFolded,
}: {
  tool: ToolRow
  marginTopOnTurn: boolean
  verbose: boolean
  isSelected?: boolean
  isExpanded?: boolean
  footnote?: string
  diffLayout?: 'auto' | 'split' | 'unified'
  toolBackground?: ToolBackground
  smoothReveal?: boolean
  fresh?: boolean
  revealVersion?: number
  foldTerminalCommand?: boolean
  onClick?(event: ClickEvent): void
  onOpenFile?: (path: string) => void
  images?: readonly TranscriptImage[]
  /** The transcript window folded this row's source (previews only). */
  sourceFolded?: boolean
}): React.ReactNode {
  return (
    <>
      <AssistantToolUseMessage
        tool={tool}
        marginTopOnTurn={marginTopOnTurn}
        verbose={verbose}
        isSelected={isSelected}
        isExpanded={isExpanded}
        footnote={footnote}
        diffLayout={diffLayout}
        toolBackground={toolBackground}
        smoothReveal={smoothReveal}
        fresh={fresh}
        revealVersion={revealVersion}
        foldTerminalCommand={foldTerminalCommand}
        onClick={onClick}
        onOpenFile={onOpenFile}
        sourceFolded={sourceFolded}
      />
      {images !== undefined && <TranscriptImages images={images} indent={4} />}
    </>
  )
}

/** An assistant text row (`●` bullet + markdown body). */
export function AssistantTextLeafRow({
  text,
  marginTopOnTurn,
  isSelected = false,
  isExpanded = false,
}: {
  text: string
  marginTopOnTurn: boolean
  isSelected?: boolean
  isExpanded?: boolean
}): React.ReactNode {
  return (
    <AssistantTextMessage
      text={text}
      marginTopOnTurn={marginTopOnTurn}
      isSelected={isSelected}
      isExpanded={isExpanded}
    />
  )
}
