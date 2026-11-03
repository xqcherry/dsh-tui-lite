import React from 'react'
import type { ClickEvent } from '../../../ink/events/click-event.js'
import type { DOMElement } from '../../../ink/dom.js'
import { t } from '../../../shared/i18n.js'
import { foldLongLines } from '../../../ui/text/fold-long-lines.js'
import { formatDuration } from '../../../ui/text/format.js'
import { THINKING_SPINNER_FRAMES } from '../../../ui/text/figures.js'
import { Box, Text, useAnimationFrame } from '../../../ui/primitives.js'
import type { BodyLine, Entry, EntryTone } from '../model/tool-entry.js'

const SPINNER_INTERVAL_MS = 80

type ToneColor = 'toolDotExec' | 'toolDotRead' | 'toolDotWrite' | 'toolDotWeb' | 'toolDotTask' | 'accent'

function toneColor(tone: EntryTone): ToneColor {
  switch (tone) {
    case 'exec':
      return 'toolDotExec'
    case 'read':
      return 'toolDotRead'
    case 'write':
      return 'toolDotWrite'
    case 'web':
      return 'toolDotWeb'
    case 'task':
      return 'toolDotTask'
    default:
      return 'accent'
  }
}

function bodyToneColor(line: BodyLine): 'diffAddedWord' | 'diffRemovedWord' | 'error' | 'ide' | undefined {
  switch (line.tone) {
    case 'add':
      return 'diffAddedWord'
    case 'del':
      return 'diffRemovedWord'
    case 'error':
      return 'error'
    case 'path':
      return 'ide'
    default:
      return undefined
  }
}

function isDim(line: BodyLine): boolean {
  return line.tone === 'dim' || line.tone === 'plain' || line.tone === 'path'
}

/** Unified status mark: spinner while live, green check / red cross once settled. */
function EntryStatusIcon({ entry, time }: { entry: Entry; time: number }): React.ReactNode {
  if (entry.status === 'running') {
    const frame = THINKING_SPINNER_FRAMES[Math.floor(time / SPINNER_INTERVAL_MS) % THINKING_SPINNER_FRAMES.length]!
    return (
      <Box width={2} flexShrink={0}>
        <Text color="accent">{frame}</Text>
      </Box>
    )
  }
  const failed = entry.status === 'error'
  return (
    <Box width={2} flexShrink={0}>
      <Text color={failed ? 'error' : toneColor(entry.tone)} bold>{failed ? '✗' : '✓'}</Text>
    </Box>
  )
}

function BodyLines({ lines, expanded }: { lines: readonly BodyLine[]; expanded: boolean }): React.ReactNode {
  return (
    <>
      {lines.map((line, index) => (
        <Box key={index} flexDirection="row" width="100%">
          <Box width={2} flexShrink={0} />
          <Box flexGrow={1} minWidth={0}>
            <Text
              color={bodyToneColor(line)}
              dimColor={isDim(line)}
              wrap="wrap"
            >
              {line.text === '' ? ' ' : (expanded ? line.text : foldLongLines(line.text).text)}
            </Text>
          </Box>
        </Box>
      ))}
    </>
  )
}

/**
 * One OpenCode-style tool/activity row.
 *
 * - Inline tools (read/search/web/job_*) are one white command line with a
 *   unified status mark and a dim duration.
 * - Block tools (shell/write/edit) put the command and its output in ONE
 *   bordered surface: the command is white, the body is recessive gray. This
 *   is the visual boundary between assistant prose and tool execution.
 * - Content is deliberately short at rest; a click or Ctrl+O reveals the
 *   bounded full body.
 */
export function ToolEntryView({
  entry,
  expanded,
  marginTop,
  onToggle,
}: {
  entry: Entry
  expanded: boolean
  marginTop: boolean
  onToggle?: () => void
}): React.ReactNode {
  const running = entry.status === 'running'
  const [ref, time] = useAnimationFrame(running ? SPINNER_INTERVAL_MS : null)
  const [hovered, setHovered] = React.useState(false)
  const clickable = entry.expandable
  const elapsed = entry.startedAt !== undefined
    ? Math.max(0, Date.now() - entry.startedAt)
    : entry.elapsedMs
  const durationMs = entry.durationMs ?? (running ? elapsed : undefined)
  const durationText = durationMs !== undefined && durationMs >= 1000 ? formatDuration(durationMs) : undefined
  const meta = [entry.meta, durationText].filter(part => part !== undefined && part !== '').join(' · ') || undefined
  const click = React.useCallback((event: ClickEvent): void => {
    if (event.cellIsBlank || !clickable) return
    onToggle?.()
  }, [clickable, onToggle])
  const hoverProps = clickable
    ? {
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
      }
    : {}

  const errorLines = entry.error === undefined
    ? []
    : entry.error.replace(/\r\n?/g, '\n').split('\n').filter(line => line !== '')
  const errorVisible = entry.status === 'error' && errorLines.length > 0
  const body = errorVisible
    ? {
        lines: (expanded ? errorLines : errorLines.slice(0, 1)).map(text => ({ text, tone: 'error' as const })),
        hiddenLines: expanded ? 0 : Math.max(0, errorLines.length - 1),
      }
    : entry.body
  const showBody = body !== undefined && (entry.mode === 'block' || expanded)
  const showInlineError = errorVisible && !showBody && !expanded

  const content = (
    <>
      <Box flexDirection="row" width="100%" minWidth={0}>
        <EntryStatusIcon entry={entry} time={time} />
        <Box flexGrow={1} minWidth={0}>
          <Text
            color="text"
            wrap="truncate-end"
          >
            {entry.title}
          </Text>
        </Box>
        {entry.mode !== 'block' && meta !== undefined && (
          <Box flexShrink={0} marginLeft={1}>
            <Text dimColor wrap="truncate-end">{meta}</Text>
          </Box>
        )}
        {clickable && (
          <Box width={2} flexShrink={0} marginLeft={1}>
            <Text dimColor>{hovered ? (expanded ? '▴' : '▾') : ' '}</Text>
          </Box>
        )}
      </Box>
      {showInlineError && (
        <Box paddingLeft={2} width="100%">
          <Text color="error" wrap="truncate-end">{errorLines[0]}</Text>
        </Box>
      )}
      {showBody && body !== undefined && (
        <Box flexDirection="column" marginTop={1} paddingLeft={entry.mode === 'block' ? 0 : 2}>
          <BodyLines lines={body.lines} expanded={expanded} />
          {!expanded && body.hiddenLines > 0 && (
            <Box flexDirection="row" width="100%">
              <Box width={2} flexShrink={0} />
              <Text dimColor wrap="truncate-end">{`… +${body.hiddenLines} lines`}</Text>
            </Box>
          )}
        </Box>
      )}
      {entry.mode === 'block' && meta !== undefined && (
        <Box paddingLeft={2} width="100%">
          <Text dimColor wrap="truncate-end">{meta}</Text>
        </Box>
      )}
    </>
  )

  return (
    <Box
      ref={ref as (element: DOMElement | null) => void}
      flexDirection="column"
      marginTop={marginTop ? 1 : 0}
      paddingLeft={3}
      width="100%"
      onClick={clickable ? click : undefined}
      {...hoverProps}
    >
      {entry.mode === 'block' ? (
        <Box
          flexDirection="column"
          width="100%"
          paddingLeft={1}
          paddingRight={1}
          borderStyle="single"
          borderTop={false}
          borderRight={false}
          borderBottom={false}
          borderLeft
          borderColor={entry.status === 'error' ? 'error' : toneColor(entry.tone)}
          backgroundColor="inputBackground"
        >
          {content}
        </Box>
      ) : content}
    </Box>
  )
}
