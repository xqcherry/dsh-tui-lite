import React from 'react'
import type { ChatRow } from '../../../shared/protocol/transcript.js'
import type { DOMElement } from '../../../ink/dom.js'
import { t } from '../../../shared/i18n.js'
import { stripNarration } from '../../../shared/platform/narration.js'
import { Box, type ScrollBoxHandle } from '../../../ui/primitives.js'
import { Divider } from '../../../ui/design-system/Divider.js'
import { MemoRow } from './TranscriptRow.js'
import { isBlockToolName } from '../model/tool-entry.js'

/** Rows mounted while pinned to the bottom. */
const TAIL_ROWS = 40
/** Older rows mounted per backfill step when the reader reaches the top. */
const BACKFILL_ROWS = 60
type WindowState = {
  readonly start: number
  readonly end: number
}

function isRenderedEmptyAssistant(row: ChatRow): boolean {
  return row.kind === 'assistant' &&
    row.streaming !== true &&
    stripNarration(row.text).trim() === '' &&
    (row.images?.length ?? 0) === 0
}

function revisionOf(row: ChatRow): string {
  switch (row.kind) {
    case 'tool': {
      const tool = row.tool
      return [
        tool?.status ?? '',
        tool?.argsText.length ?? 0,
        tool?.resultText?.length ?? 0,
        tool?.resultFull?.length ?? 0,
        tool?.errorText?.length ?? 0,
        tool?.callView?.card ?? '',
        tool?.resultView?.card ?? '',
        tool?.resultView?.title?.length ?? 0,
      ].join('|')
    }
    case 'job': {
      const job = row.job
      return [
        job?.status ?? '',
        job?.label.length ?? 0,
        job?.detail?.length ?? 0,
        job?.progress?.length ?? 0,
        job?.outputLines.length ?? 0,
        job?.outputLines.slice(-2).map(line => line.text.length).join(','),
        job?.finishedAt ?? '',
      ].join('|')
    }
    case 'subagent': {
      const subagent = row.subagent
      return [
        subagent?.status ?? '',
        subagent?.description.length ?? 0,
        subagent?.toolCalls.length ?? 0,
        subagent?.outputLines.length ?? 0,
        subagent?.error?.length ?? 0,
        subagent?.completedAt ?? '',
      ].join('|')
    }
    case 'reasoning':
      return `${row.streaming === true ? 1 : 0}|${row.thinkingOpen === true ? 1 : 0}|${row.durationMs ?? ''}`
    default:
      return ''
  }
}

function captureAnchor(
  scrollHandle: ScrollBoxHandle,
  refs: ReadonlyMap<number, DOMElement>,
): { rowId: number; screenY: number } | null {
  const scrollTop = scrollHandle.getScrollTop()
  let bestId: number | undefined
  let bestTop = Number.POSITIVE_INFINITY
  for (const [rowId, el] of refs) {
    const top = el.yogaNode?.getComputedTop()
    const height = el.yogaNode?.getComputedHeight() ?? 0
    if (top === undefined || top + height <= scrollTop) continue
    if (top < bestTop) {
      bestTop = top
      bestId = rowId
    }
  }
  if (bestId === undefined) return null
  return { rowId: bestId, screenY: bestTop - scrollTop }
}

function LoadEarlier({ onClick }: { onClick?: () => void }): React.ReactNode {
  if (onClick === undefined) return null
  return (
    <Box marginTop={1} width="100%" onClick={onClick}>
      <Divider title={t('load-earlier')} />
    </Box>
  )
}

/**
 * Tail-window transcript: only the newest rows mount by default. Reaching
 * the top backfills another chunk; leaving the bottom freezes the window so
 * append-only streaming never steals the reader's position. There are no
 * top/bottom spacers, height caches or measure loops — the mounted rows are
 * the scroll geometry.
 */
export function MessageList({
  rows,
  expanded,
  expandedRows,
  selectedId,
  onToggleRow,
  model,
  thinkingVisible = true,
  olderHistory,
  onLoadOlder,
  sessionCwd,
  scrollHandle = null,
  fullscreen = false,
}: {
  rows: readonly ChatRow[]
  expanded: boolean
  expandedRows: ReadonlySet<number>
  selectedId: number | null
  onToggleRow: (rowId: number) => void
  model: string
  thinkingVisible?: boolean
  olderHistory?: boolean
  onLoadOlder?: () => void
  sessionCwd?: string
  scrollHandle?: ScrollBoxHandle | null
  fullscreen?: boolean
}): React.ReactNode {
  const [windowState, setWindowState] = React.useState<WindowState | null>(null)
  const [scrollTick, setScrollTick] = React.useState(0)
  const windowRef = React.useRef<WindowState | null>(null)
  windowRef.current = windowState
  const localRefs = React.useRef(new Map<number, DOMElement>())
  const backfillPendingRef = React.useRef(false)
  const pendingAnchorRef = React.useRef<{ rowId: number; screenY: number } | null>(null)
  const expandAnchorRef = React.useRef<{ rowId: number; screenY: number } | null>(null)
  const olderPendingRef = React.useRef(false)

  // The filter is deliberately recomputed rather than memoized on rows
  // identity: the channel mutates rows in place, so a streaming row can
  // cross the empty-assistant boundary without changing either array.
  const filtered: ChatRow[] = []
  for (const row of rows) {
    if (row.kind === 'turn-summary' || row.kind === 'job') continue
    if (!thinkingVisible && row.kind === 'reasoning') continue
    // Replayed/reattached reasoning carries no duration; a settled
    // "Thought" with no time is indistinguishable from a stray row. Keep
    // it out of the reading flow until Ctrl+O / the full-thinking setting
    // asks for the reasoning body. Live rows (streaming or timed) stay.
    if (
      row.kind === 'reasoning' &&
      row.streaming !== true &&
      row.durationMs === undefined &&
      row.thinkingOpen !== true &&
      !expanded &&
      !expandedRows.has(row.id)
    ) continue
    if (isRenderedEmptyAssistant(row)) continue
    filtered.push(row)
  }

  const total = filtered.length
  const tailStart = Math.max(0, total - TAIL_ROWS)
  const inlineFallback = scrollHandle === null && !fullscreen
  const start = inlineFallback
    ? 0
    : windowState === null
      ? tailStart
      : Math.min(windowState.start, Math.max(0, total - 1))
  const end = inlineFallback
    ? total
    : windowState === null
      ? total
      : Math.min(Math.max(windowState.end, start + 1), total)
  const visible = filtered.slice(start, end)

  React.useEffect(() => { setWindowState(null) }, [thinkingVisible])

  React.useEffect(() => {
    if (scrollHandle === null) return
    return scrollHandle.subscribe(() => setScrollTick(tick => tick + 1))
  }, [scrollHandle])

  React.useEffect(() => {
    if (scrollHandle === null) return
    const top = scrollHandle.getScrollTop()
    const viewport = scrollHandle.getViewportHeight()
    const height = scrollHandle.getScrollHeight()
    if (height <= 0 || viewport <= 0) return
    const sticky = scrollHandle.isSticky()
    const current = windowRef.current

    if (sticky) {
      if (current !== null) setWindowState(null)
      return
    }

    if (top <= viewport && start > 0) {
      if (backfillPendingRef.current) return
      backfillPendingRef.current = true
      pendingAnchorRef.current = captureAnchor(scrollHandle, localRefs.current)
      setWindowState({ start: Math.max(0, start - BACKFILL_ROWS), end: current?.end ?? total })
      return
    }

    if (top + viewport >= height - 1) {
      if (current === null) return
      if (end < total) {
        setWindowState({ start: current.start, end: Math.min(total, end + BACKFILL_ROWS) })
        return
      }
      setWindowState(null)
      scrollHandle.scrollToBottom()
    }
  }, [scrollTick, scrollHandle, start, end, total])

  React.useLayoutEffect(() => {
    if (scrollHandle === null) return
    const pending = pendingAnchorRef.current
    if (pending !== null) {
      pendingAnchorRef.current = null
      const el = localRefs.current.get(pending.rowId)
      if (el !== undefined) scrollHandle.scrollToElement(el, -pending.screenY)
    }
    const anchor = expandAnchorRef.current
    if (anchor !== null) {
      expandAnchorRef.current = null
      const el = localRefs.current.get(anchor.rowId)
      if (el !== undefined) scrollHandle.scrollToElement(el, -anchor.screenY)
    }
    backfillPendingRef.current = false
  }, [scrollHandle, windowState, expanded, expandedRows])

  React.useEffect(() => {
    if (!olderPendingRef.current) return
    olderPendingRef.current = false
    setWindowState({ start: 0, end: total })
  }, [total])

  const setRowRef = React.useCallback((rowId: number, el: DOMElement | null): void => {
    if (el === null) localRefs.current.delete(rowId)
    else localRefs.current.set(rowId, el)
  }, [])

  const toggleRow = React.useCallback((rowId: number): void => {
    if (scrollHandle !== null && !scrollHandle.isSticky()) {
      const el = localRefs.current.get(rowId)
      const top = el?.yogaNode?.getComputedTop()
      if (top !== undefined) {
        expandAnchorRef.current = { rowId, screenY: top - scrollHandle.getScrollTop() }
      }
    }
    onToggleRow(rowId)
  }, [onToggleRow, scrollHandle])

  const loadOlder = React.useCallback((): void => {
    olderPendingRef.current = true
    if (scrollHandle !== null && !scrollHandle.isSticky()) {
      pendingAnchorRef.current = captureAnchor(scrollHandle, localRefs.current)
    }
    onLoadOlder?.()
  }, [onLoadOlder, scrollHandle])

  const showOlder = start === 0 && (olderHistory === true || rows.some(row => row.folded === true))
  let previousRow: ChatRow | undefined
  return (
    <>
      {showOlder && <LoadEarlier onClick={onLoadOlder === undefined ? undefined : loadOlder} />}
      {visible.map(row => {
        const denseTools = previousRow?.kind === 'tool' && row.kind === 'tool' &&
          previousRow.tool !== undefined && row.tool !== undefined &&
          !isBlockToolName(previousRow.tool.name) && !isBlockToolName(row.tool.name)
        const marginTop = previousRow !== undefined && !denseTools
        previousRow = row
        return (
          <MemoRow
            key={row.id}
            row={row}
            text={row.text}
            revision={revisionOf(row)}
            expanded={expanded}
            isRowExpanded={expandedRows.has(row.id)}
            isSelected={selectedId === row.id}
            marginTop={marginTop}
            model={model}
            sessionCwd={sessionCwd}
            onToggleRow={toggleRow}
            setRowRef={setRowRef}
          />
        )
      })}
    </>
  )
}
