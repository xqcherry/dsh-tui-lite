import type { ImageTokenSpan } from '../model/image-tokens.js'
import type { PendingMessage } from '../../../shared/protocol/composer.js'
import type { CommandCompletion } from '../../../shared/protocol/commands.js'
import { HOME_BUTTON_TEXT, HOME_BUTTON_COLS, isBigInput, MAX_VISIBLE_LINES, DOUBLE_CLICK_MS, wrapToWidth, caretInText, clickToCursorOffset, visualLineRanges, wordSelectionAt } from '../model/geometry.js'


import { graphemeBoundaries, nextGraphemeBoundary, normalizeCursorOffset } from '../model/editing.js'
import type { DraftUndoEntry, UndoMode } from '../model/editing.js'

import React from 'react'


import { t } from '../../../shared/i18n.js'
import type { ComposerPort as Channel } from '../contracts.js'
import type { ClickEvent } from '../../../ink/events/click-event.js'
import type { DragEvent } from '../../../ink/events/drag-event.js'
import { noteAuxNumber } from '../../../ink/geometry-trace.js'
import { useDeclaredCursor } from '../../../ink/hooks/use-declared-cursor.js'
import instances from '../../../ink/instances.js'
import type { Color } from '../../../ink/styles.js'

import { truncateToWidth } from '../../../ink/truncateToWidth.js'


import { type FileCandidate } from '../../../shared/platform/file-suggestions.js'


import { stringWidth } from '../../../shared/platform/stringWidth.js'
import { Box, Text, type ScrollBoxHandle } from '../../../ui/primitives.js'
import { sessionColorHex } from '../../../ui/text/sessionColors.js'

import { CommandSuggestions } from './CommandSuggestions.js'
import { EffortChargeGlyph } from './EffortChargeGlyph.js'
import { EffortInputBorder, type InputBorderLabel } from './EffortInputBorder.js'
import { EffortTierBadge } from './EffortTierBadge.js'
import { FileSuggestions } from './FileSuggestions.js'
import { HelpMenu } from '../../../ui/HelpMenu.js'
import { OverlayAbove, useOverlayListRows } from '../../../ui/OverlayAbove.js'
import { cardContentWidth, SuggestionCard } from '../../../ui/SuggestionCard.js'
import { listWindow } from '../../../ui/listWindow.js'


interface Context {
  readonly onOpenSessions: (() => void) | undefined
  readonly channel: Channel
  readonly columns: number
  readonly foldBlock: { start: number; end: number; } | null
  readonly value: string
  readonly cursor: number
  readonly hovered: boolean
  readonly selectionActive: boolean
  readonly cursorColor: string
  readonly boundImageSpans: (text: string) => ImageTokenSpan[]
  readonly selection: { start: number; end: number; } | null
  readonly cursorGlyph: "text" | "inverseText"
  readonly updateFoldBlock: (block: { start: number; end: number; } | null) => void
  readonly hoverEnter: () => void
  readonly hoverLeave: () => void
  readonly toastSuppressed: ((item: Channel["notifications"][number]) => boolean) | undefined
  readonly suspended: boolean
  readonly lastClickAtRef: React.RefObject<number>
  readonly lastClickColRef: React.RefObject<number>
  readonly lastClickRowRef: React.RefObject<number>
  readonly updateSelection: (start: number, end: number) => void
  readonly placeCaret: (offset: number, prefer: "start" | "end" | "nearest") => void
  readonly selectionRef: React.RefObject<{ start: number; end: number; } | null>
  readonly cursorRef: React.RefObject<number>
  readonly clearSelection: () => void
  readonly dragAnchorRef: React.RefObject<number | null>
  readonly setCursor: React.Dispatch<React.SetStateAction<number>>
  readonly foldBlockRef: React.RefObject<{ start: number; end: number; } | null>
  readonly valueRef: React.RefObject<string>
  readonly dockSelected: number | null
  readonly dockCount: number
  readonly dockedPending: PendingMessage[]
  readonly helpOpen: boolean
  readonly fileOverlayOpen: boolean
  readonly overlayOpen: boolean
  readonly terminalRows: number
  readonly helpViewportHeight: number
  readonly helpScrollRef: React.RefObject<ScrollBoxHandle | null>
  readonly setInput: (next: string, cursorOffset?: number, undo?: UndoMode, snapshotBlock?: DraftUndoEntry["block"]) => void
  readonly onToggleHelp: () => void
  readonly editDocked: (index: number) => void
  readonly sendDocked: () => void
  readonly fileMatches: readonly FileCandidate[]
  readonly fileSelected: number
  readonly mention: { start: number; end: number; query: string; pathEnd?: number; } | undefined
  readonly acceptFile: (candidate: FileCandidate) => void
  readonly setFileSelected: React.Dispatch<React.SetStateAction<number>>
  readonly suggestions: readonly CommandCompletion[]
  readonly selectedCommand: number
  readonly chooseCommand: (text: string) => void
  readonly setSelectedCommand: React.Dispatch<React.SetStateAction<number>>
  readonly setHovered: React.Dispatch<React.SetStateAction<boolean>>
  readonly setHomeHovered: React.Dispatch<React.SetStateAction<boolean>>
  readonly homeHovered: boolean
}

export function useComposerView(context: Context): React.ReactNode {
const { onOpenSessions, channel, columns, foldBlock, value, cursor, hovered, selectionActive, cursorColor, boundImageSpans, selection, cursorGlyph, updateFoldBlock, hoverEnter, hoverLeave, toastSuppressed, suspended, lastClickAtRef, lastClickColRef, lastClickRowRef, updateSelection, placeCaret, selectionRef, cursorRef, clearSelection, dragAnchorRef, setCursor, foldBlockRef, valueRef, dockSelected, dockCount, dockedPending, helpOpen, fileOverlayOpen, overlayOpen, terminalRows, helpViewportHeight, helpScrollRef, setInput, onToggleHelp, editDocked, sendDocked, fileMatches, fileSelected, mention, acceptFile, setFileSelected, suggestions, selectedCommand, chooseCommand, setSelectedCommand, setHovered, setHomeHovered, homeHovered } = context
const homeButtonCols = onOpenSessions === undefined ? 0 : HOME_BUTTON_COLS
const sessionAccent = sessionColorHex(channel.sessionColor ?? '')
const promptAccent = channel.mode.plan === true ? 'planMode' : (sessionAccent ?? 'promptBorder')
const inputWidth = Math.max(1, columns - 3 - homeButtonCols)
const block = foldBlock
const foldText = block ? value.slice(block.start, block.end) : value
const head = block ? value.slice(0, block.start) : ''
const tail = block ? value.slice(block.end) : ''
const headRows = block ? wrapToWidth(head, inputWidth) : []
const tailRows = block ? wrapToWidth(tail, inputWidth) : []
const chipRow = block ? headRows.length : -1
const visualLines = block
    ? [...headRows, '', ...tailRows]
    : wrapToWidth(value, inputWidth)
const caretPlaced = block
    ? cursor <= block.start
      ? caretInText(head, inputWidth, cursor)
      : caretInText(tail, inputWidth, Math.max(0, cursor - block.end))
    : caretInText(value, inputWidth, cursor)
const caretVisualLine =
    block && cursor > block.start
      ? headRows.length + 1 + caretPlaced.line
      : caretPlaced.line
const caretCharCol = caretPlaced.charCol
const caretVisualCol = caretPlaced.visualCol
const big = isBigInput(foldText)
const stats = big
    ? t('input-fold-stats', { lines: foldText.split('\n').length, chars: foldText.length })
    : ''
const peekOpen = block !== null && hovered && !selectionActive
const windowStart = Math.max(0, Math.min(caretVisualLine - MAX_VISIBLE_LINES + 1, visualLines.length - MAX_VISIBLE_LINES))
const visibleCount = MAX_VISIBLE_LINES
const visibleLines = visualLines.slice(
    windowStart,
    windowStart + visibleCount,
  )
const prevWindowStartRef = React.useRef(windowStart)
React.useLayoutEffect(() => {
    if (windowStart !== prevWindowStartRef.current) {
      prevWindowStartRef.current = windowStart
      const ink = instances.get(process.stdout) ?? instances.values().next().value
      ink?.invalidatePrevFrame()
      ink?.reanchorViewport()
    }
  }, [windowStart])
const foldBadge = `▸ ${stats}`
const foldHint = t('input-fold-hover')
const foldPreviewWidth =
    inputWidth - stringWidth(foldBadge) - stringWidth(`・${foldHint}`) - 6
const foldPreview =
    foldPreviewWidth >= 8
      ? truncateToWidth(foldText.split('\n')[0] ?? '', foldPreviewWidth)
      : ''
const prefixLabel = `▾ ${stats}・`
const prefixCols =
    !block && big && windowStart === 0 ? stringWidth(prefixLabel) : 0
const lineRanges: Array<[number, number]> = block
    ? [
        ...visualLineRanges(head, inputWidth),
        [block.start, block.end],
        ...visualLineRanges(tail, inputWidth).map(
          ([s, e]): [number, number] => [s + block.end, e + block.end],
        ),
      ]
    : visualLineRanges(value, inputWidth)
const rowHighlightPieces = (
    text: string,
    absoluteLine: number,
  ): Array<{ text: string; inverse: boolean; chip: boolean; caret: boolean }> => {
    const [rowStart] = lineRanges[absoluteLine] ?? [0, 0]
    // Per-character style: 0 plain, 1 chip (a staged token), 2 inverse
    // (selection, or caret when the palette has no `cursor`), 3 caret.
    // Later fills win: chip < selection < caret.
    const PLAIN = 0
    const CHIP = 1
    const INVERSE = 2
    const CARET = 3
    const caretKind = cursorColor === '' ? INVERSE : CARET
    const kinds = new Uint8Array(text.length)
    const fill = (lo: number, hi: number, kind: number): void => {
      for (let i = Math.max(lo, 0); i < Math.min(hi, text.length); i++) kinds[i] = kind
    }
    const spans = boundImageSpans(value)
    for (const span of spans) fill(span.start - rowStart, span.end - rowStart, CHIP)
    const sel = selection
    if (sel) fill(sel.start - rowStart, sel.end - rowStart, INVERSE)
    let endBlankCaret = false
    if (absoluteLine === caretVisualLine) {
      const col = Math.min(caretCharCol, text.length)
      // A staged token is one caret cluster: with the caret at its start the
      // whole token inverts (the selected-chip look), and Delete removes it.
      const tokenAtCaret = spans.find(span => span.start === rowStart + col)
      const clusterEnd = tokenAtCaret !== undefined
        ? Math.min(tokenAtCaret.end - rowStart, text.length)
        : nextGraphemeBoundary(graphemeBoundaries(text), col)
      if (clusterEnd > col) fill(col, clusterEnd, caretKind)
      else endBlankCaret = col === text.length
    }
    const pieces: Array<{ text: string; inverse: boolean; chip: boolean; caret: boolean }> = []
    let pos = 0
    while (pos < text.length) {
      const kind = kinds[pos]!
      let end = pos + 1
      while (end < text.length && kinds[end] === kind) end++
      pieces.push({
        text: text.slice(pos, end),
        inverse: kind === INVERSE,
        chip: kind === CHIP,
        caret: kind === CARET,
      })
      pos = end
    }
    if (endBlankCaret) {
      pieces.push({ text: ' ', inverse: caretKind === INVERSE, chip: false, caret: caretKind === CARET })
    }
    return pieces
  }
const caretCell = (key: React.Key, text: string): React.ReactNode =>
    cursorColor === ''
      ? <Text key={key} inverse>{text}</Text>
      : <Text key={key} backgroundColor={cursorColor as Color} color={cursorGlyph}>{text}</Text>
const rendered = visibleLines.map((line, index) => {
    const absoluteLine = windowStart + index
    if (block && absoluteLine === chipRow) {
      // The fold block's atomic chip row: click expands it; hover pops the
      // peek card. The row is one line no matter how big the block is.
      return (
        <Box
          key={`fold-${absoluteLine}`}
          flexDirection="row"
          onClick={(event) => {
            event.stopImmediatePropagation()
            updateFoldBlock(null)
          }}
          onMouseEnter={hoverEnter}
          onMouseLeave={hoverLeave}
        >
          <Text dimColor>{foldBadge}</Text>
          {foldPreview !== '' && <Text dimColor>・</Text>}
          {foldPreview !== '' && <Text wrap="truncate-end">{foldPreview}</Text>}
          <Text dimColor>{`・${foldHint}`}</Text>
        </Box>
      )
    }
    const withPrefix = absoluteLine === 0 && prefixCols > 0
    const text = withPrefix ? truncateToWidth(line, inputWidth - prefixCols) : line
    const prefix = withPrefix ? <Text dimColor>{prefixLabel}</Text> : null
    const pieces = rowHighlightPieces(text, absoluteLine)
    return (
      <Text key={absoluteLine} wrap="truncate-end">
        {prefix}
        {pieces.length === 0 ? ' ' : pieces.map((piece, pieceIndex) =>
          piece.caret ? (
            caretCell(pieceIndex, piece.text)
          ) : piece.inverse ? (
            <Text key={pieceIndex} inverse>
              {piece.text}
            </Text>
          ) : piece.chip ? (
            <Text key={pieceIndex} color="suggestion">
              {piece.text}
            </Text>
          ) : (
            piece.text
          ),
        )}
      </Text>
    )
  })
const PEEK_MAX_ROWS = 10
const peekVisualLines: string[] = []
for (const line of foldText.split('\n')) {
    for (const row of wrapToWidth(line, cardContentWidth(columns))) {
      if (peekVisualLines.length >= PEEK_MAX_ROWS) break
      peekVisualLines.push(row)
    }
    if (peekVisualLines.length >= PEEK_MAX_ROWS) break
  }
const peekClipped = peekVisualLines.length >= PEEK_MAX_ROWS
const contentRows = value.length === 0 ? 1 : visibleLines.length
noteAuxNumber('promptContentRows', contentRows)
const prevContentRowsRef = React.useRef(contentRows)
React.useLayoutEffect(() => {
    if (contentRows < prevContentRowsRef.current) {
      const ink = instances.get(process.stdout) ?? instances.values().next().value
      ink?.invalidatePrevFrame()
      ink?.reanchorViewport()
    }
    prevContentRowsRef.current = contentRows
  }, [contentRows])
const lastNotification =
    channel.notifications[channel.notifications.length - 1]
const toastVisible =
    lastNotification !== undefined && (toastSuppressed?.(lastNotification) ?? false) !== true
const valueBoxRef = useDeclaredCursor({
    line: caretVisualLine - windowStart,
    // Clamp the declared column to the wrap width: a grapheme wider than
    // the last remaining column (emoji at width 1) can push the visual
    // column past inputWidth, and the park must stay inside the value box.
    column: Math.min(
      caretVisualCol,
      inputWidth,
    ),
    active: !suspended && !selectionActive,
  })
const localToOffset = (localCol: number, localRow: number): number | null => {
    const lastVisible = Math.min(visualLines.length - 1, windowStart + visibleCount - 1)
    const clamped = Math.max(windowStart, Math.min(windowStart + localRow, lastVisible))
    // Fold prefix (▾) row: the rendered first row is truncated by prefixCols,
    // so both the column and the wrap budget shift — without the correction
    // a drag starting on the first row lands prefixCols to the right of the
    // pointer (consistent with handleValueClick's click mapping). Presses ON the
    // prefix cells clamp to the row start (drag-from-0, like selecting the
    // whole first row backwards).
    const isPrefixRow = !block && clamped === 0 && prefixCols > 0
    const col = isPrefixRow ? Math.max(0, localCol - prefixCols) : localCol
    const width = isPrefixRow ? inputWidth - prefixCols : inputWidth
    if (block) {
      if (clamped === chipRow) return null
      return clamped < chipRow
        ? clickToCursorOffset(head, width, clamped, col)
        : block.end + clickToCursorOffset(tail, width, clamped - chipRow - 1, col)
    }
    return clickToCursorOffset(value, width, clamped, col)
  }
const handleValueClick = (e: ClickEvent, colOffset = 0) => {
    const now = Date.now()
    const modified = e.shift || e.alt || e.ctrl
    const isDouble =
      !modified &&
      now - lastClickAtRef.current < DOUBLE_CLICK_MS &&
      Math.abs(e.col - lastClickColRef.current) <= 1 &&
      Math.abs(e.row - lastClickRowRef.current) <= 1
    if (modified) {
      // Shift+click is range extension, never a word-select click. It also
      // breaks the local chain so a following plain click cannot complete a
      // double-click that started under a modifier.
      lastClickAtRef.current = 0
      lastClickColRef.current = -1
      lastClickRowRef.current = -1
    } else {
      lastClickAtRef.current = now
      lastClickColRef.current = e.col
      lastClickRowRef.current = e.row
    }
    const localCol = e.localCol - colOffset
    const clickedVisual = windowStart + e.localRow
    const clamped = Math.max(0, Math.min(clickedVisual, visualLines.length - 1))
    if (block) {
      if (clamped === chipRow) return
      const offset =
        clamped < chipRow
          ? clickToCursorOffset(head, inputWidth, clamped, localCol, isDouble ? 'grapheme-start' : 'nearest')
          : block.end + clickToCursorOffset(tail, inputWidth, clamped - chipRow - 1, localCol, isDouble ? 'grapheme-start' : 'nearest')
      if (isDouble) {
        // Word select stays inside the clicked side: the block is atomic.
        const side = offset <= block.start
        const w = wordSelectionAt(value, offset, side ? 0 : block.end, side ? block.start : value.length)
        if (w) {
          updateSelection(w.start, w.end)
          placeCaret(selectionRef.current?.end ?? w.end, 'end')
        }
        return
      }
      if (e.shift) {
        const base = selectionRef.current ? selectionRef.current.start : cursorRef.current
        updateSelection(base, offset)
        placeCaret(offset, 'nearest')
        return
      }
      clearSelection()
      // A click on a staged token puts the caret at its start: the token is
      // the caret cluster, so it highlights whole.
      placeCaret(offset, 'start')
      return
    }
    if (clamped === 0 && prefixCols > 0 && localCol < prefixCols) {
      // Folding hides the entire editable projection, so no selection may
      // survive invisibly inside the chip and keep owning Ctrl+C/Delete.
      clearSelection()
      dragAnchorRef.current = null
      setCursor(value.length)
      updateFoldBlock({ start: 0, end: value.length })
      return
    }
    const col =
      clamped === 0 && prefixCols > 0 ? Math.max(0, localCol - prefixCols) : localCol
    const offset = clickToCursorOffset(
      value,
      clamped === 0 && prefixCols > 0 ? inputWidth - prefixCols : inputWidth,
      clamped,
      col,
      isDouble ? 'grapheme-start' : 'nearest',
    )
    if (isDouble) {
      const w = wordSelectionAt(value, offset, 0, value.length)
      if (w) {
        updateSelection(w.start, w.end)
        placeCaret(selectionRef.current?.end ?? w.end, 'end')
      }
      return
    }
    if (e.shift) {
      const base = selectionRef.current ? selectionRef.current.start : cursorRef.current
      updateSelection(base, offset)
      placeCaret(offset, 'nearest')
      return
    }
    clearSelection()
    placeCaret(offset, 'start')
  }
const handleDragStart = (e: DragEvent, colOffset = 0) => {
    const anchorLocalCol = e.localCol - (e.col - e.startCol) - colOffset
    const anchorLocalRow = e.localRow - (e.row - e.startRow)
    const anchor = localToOffset(anchorLocalCol, anchorLocalRow)
    if (anchor === null) {
      dragAnchorRef.current = null
      return
    }
    dragAnchorRef.current = anchor
    placeCaret(anchor, 'nearest')
  }
const handleDragMove = (e: DragEvent, colOffset = 0) => {
    const anchor = dragAnchorRef.current
    if (anchor === null) return
    const focus = localToOffset(e.localCol - colOffset, e.localRow)
    if (focus === null) return
    // The caret rides the focus edge, clamped into the anchor's fold side
    // exactly like updateSelection clamps the range — the caret must never
    // jump across the chip row while the selection stays behind.
    let caret = focus
    const block = foldBlockRef.current
    if (block) {
      caret = anchor <= block.start ? Math.min(focus, block.start) : Math.max(focus, block.end)
    }
    updateSelection(anchor, focus)
    placeCaret(normalizeCursorOffset(valueRef.current, caret), 'nearest')
  }
const handleDragEnd = () => {
    dragAnchorRef.current = null
  }
const steerPreviewCount = channel.pending.filter(
    item => item.placement === 'steer' && item.docked !== true,
  ).length
const followupPreviewCount = channel.pending.filter(
    item => item.placement === 'followup' && item.docked !== true,
  ).length
const dockWindowRows = useOverlayListRows(
    (steerPreviewCount > 0 ? 1 + steerPreviewCount : 0)
    + (followupPreviewCount > 0 ? 1 + followupPreviewCount : 0)
    + 1 /* dock label */ + 1 /* dock hint row */ + 1 /* Alt+↑ hint */ + 1 /* block paddingBottom */,
  )
const dockFocus = dockSelected ?? Math.max(dockCount - 1, 0)
const { start: dockStart, end: dockEnd } = listWindow(
    dockedPending.map(() => 1),
    dockFocus,
    dockWindowRows,
  )
const floatersOpen =
    !suspended &&
    (helpOpen || channel.pending.length > 0 || fileOverlayOpen || overlayOpen || peekOpen)
const sessionTitle = channel.sessionTitle ?? ''
const topRightLabel: InputBorderLabel | undefined =
    channel.promptSessionLabel === true && sessionTitle !== ''
      ? {
          text: truncateToWidth(sessionTitle, Math.max(8, Math.min(28, columns - 8))),
          color: channel.mode.plan === true ? 'planMode' : (sessionAccent ?? 'accent'),
          ink: 'inverseText',
        }
      : undefined
const prevFloatersOpenRef = React.useRef(floatersOpen)
React.useLayoutEffect(() => {
    if (floatersOpen === prevFloatersOpenRef.current) return
    prevFloatersOpenRef.current = floatersOpen
    const ink = instances.get(process.stdout) ?? instances.values().next().value
    ink?.invalidatePrevFrame()
    ink?.reanchorViewport()
  }, [floatersOpen])
if (suspended) return null
return (
    <Box flexDirection="column" marginTop={1}>
      {/* 瞬态面板浮层（帮助/队列/补全）：零布局高度、向上覆盖转录尾部，
          帧高不随面板开关涨落——否则帧顶行会被滚进 scrollback 并在关闭
          重绘时二次写入（/model 切换多一份启动画的根因，见 OverlayAbove）。 */}
      {floatersOpen && (
      <OverlayAbove maxHeight={Math.max(terminalRows - 6, 1)}>
        {helpOpen && (
          <Box marginBottom={1}>
            <HelpMenu
              commands={channel.commandList}
              viewportHeight={helpViewportHeight}
              viewportWidth={columns}
              scrollRef={helpScrollRef}
              onCommandPick={(name) => {
                // 点击命令行 = 填入 /name 并关闭帮助（Tab 补全的鼠标等价）
                updateFoldBlock(null)
                // `/${name} ` — the whole fill is one undo step.
                setInput(`/${name} `, name.length + 2, 'step')
                onToggleHelp()
              }}
            />
          </Box>
        )}
        {!helpOpen && channel.pending.length > 0 && (
          <Box flexDirection="column" paddingLeft={2} paddingBottom={1}>
            {channel.pending.some(item => item.placement === 'steer' && item.docked !== true) && (
              <Box flexDirection="column">
                <Text dimColor>⚡ {t('input-pending-steer-label')}</Text>
                {channel.pending
                  .filter(item => item.placement === 'steer' && item.docked !== true)
                  .map(item => (
                    <Text key={item.id} dimColor wrap="truncate">
                      {'  '}↳ {item.text}
                    </Text>
                  ))}
              </Box>
            )}
            {channel.pending.some(item => item.placement === 'followup' && item.docked !== true) && (
              <Box flexDirection="column">
                <Text dimColor>⏳ {t('input-pending-queue-label')}</Text>
                {channel.pending
                  .filter(item => item.placement === 'followup' && item.docked !== true)
                  .map(item => (
                    <Text key={item.id} dimColor wrap="truncate">
                      {'  '}↳ {item.text}
                    </Text>
                  ))}
              </Box>
            )}
            {dockCount > 0 && (
              <Box flexDirection="column">
                <Text dimColor>⏸ {t('input-pending-dock-label')}</Text>
                {dockedPending.slice(dockStart, dockEnd).map((item, index) => {
                  // The window maps to absolute dock indices: the click and
                  // the highlight name the same row the user sees.
                  const absoluteIndex = dockStart + index
                  return (
                    <Box
                      key={item.id}
                      // 点击停靠行 = 撤回该条进输入框编辑（与选择器 ⏎ 同路径）
                      onClick={() => { editDocked(absoluteIndex) }}
                    >
                      <Text wrap="truncate" dimColor={dockSelected === null || dockSelected !== absoluteIndex} color={dockSelected === absoluteIndex ? promptAccent : undefined}>
                        {'  '}{dockSelected === absoluteIndex ? '❯' : '↳'} {item.text}
                      </Text>
                    </Box>
                  )
                })}
                <Box
                  // 点击提示行 = 全部发送（与空输入 ⏎ 同路径）
                  onClick={() => { sendDocked() }}
                >
                  <Text dimColor>{' '}{t('input-pending-dock-hint')}</Text>
                </Box>
              </Box>
            )}
            <Text dimColor>Alt+↑ {t('input-pending-actions-hint')}</Text>
          </Box>
        )}
        {fileOverlayOpen && (
          <FileSuggestions
            files={fileMatches}
            selectedIndex={fileSelected}
            columns={columns}
            query={mention?.query ?? ''}
            accent={promptAccent}
            // 点击行 = 接受该项（与 Enter 同路径）
            onPick={(index) => {
              const file = fileMatches[index]
              if (file) acceptFile(file)
            }}
            // 滚轮 = 移动选中行（与 ↑/↓ 同路径，窗口跟随）
            onWheelStep={(step) => {
              setFileSelected(i => Math.max(0, Math.min(fileMatches.length - 1, i + step)))
            }}
          />
        )}
        {overlayOpen && (
          <CommandSuggestions
            commands={suggestions}
            selectedIndex={selectedCommand}
            columns={columns}
            query={value}
            accent={promptAccent}
            // 点击行 = 运行该命令（与 Enter 同路径）
            onPick={(index) => {
              const command = suggestions[index]
              if (command) chooseCommand(command.commandLine)
            }}
            // 滚轮 = 移动选中行（与 ↑/↓ 同路径，窗口跟随）
            onWheelStep={(step) => {
              setSelectedCommand(i => Math.max(0, Math.min(suggestions.length - 1, i + step)))
            }}
          />
        )}
        {peekOpen && (
          // 悬停预览卡片：只读展示折叠内容的头部（输入框自身保持一行，
          // 布局零跳动）。点击任一行 = 固定展开进入真实输入框编辑；悬停
          // 期间鼠标直接打字同样先展开（见折叠态按键分支）。卡片自身的
          // enter/leave 维持 hovered，防止 chip→卡片过渡闪烁。
          <Box onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
            <SuggestionCard
              title={stats}
              columns={columns}
              accent={promptAccent}
              footer={
                peekClipped
                  ? t('input-fold-peek-footer', { lines: foldText.split('\n').length })
                  : undefined
              }
              rows={peekVisualLines.map((row, index) => (
                <Text key={index} wrap="truncate-end">
                  {row}
                </Text>
              ))}
              onRowPick={() => {
                updateFoldBlock(null)
                setHovered(false)
              }}
            />
          </Box>
        )}
      </OverlayAbove>
      )}
      {lastNotification && toastVisible && (
        // position=absolute takes zero layout height so the transcript never
        // shifts when a notification appears/disappears; the layer floats one
        // row above the prompt border, right-aligned.
        <Box
          position="absolute"
          marginTop={-1}
          height={1}
          width="100%"
          paddingLeft={2}
          paddingRight={1}
          flexDirection="column"
          justifyContent="flex-end"
          overflow="hidden"
        >
          <Box justifyContent="flex-end">
            <Text
              color={lastNotification.color}
              dimColor={!lastNotification.color}
              wrap="truncate"
            >
              {lastNotification.text}
            </Text>
          </Box>
        </Box>
      )}
      {/* The prompt's own top/bottom border rows, self-drawn so the effort
          overlay can play on them (sweep → tier name → fade; see
          EffortInputBorder). Idle colour keeps the plan-mode accent the old
          Box border carried. */}
      <EffortInputBorder
        effort={channel.reasoningEffort}
        levels={channel.effortLevels}
        columns={columns}
        idleColor={promptAccent}
        topRightLabel={topRightLabel}
      >
        <Box flexDirection="row" alignItems="flex-start" width="100%">
          {/* ⌂ 会话列表入口：点击打开会话浏览；hover 提亮为输入框强调色。
              行首固定 2 列（`⌂` 1 列 + 分隔空格 1 列，见 homeButtonCols）；
              未传 onOpenSessions 时整体不渲染（宽度预算同步归还）。 */}
          {onOpenSessions !== undefined && (
            <Box
              flexShrink={0}
              onClick={(event) => {
                event.stopImmediatePropagation()
                onOpenSessions?.()
              }}
              onMouseEnter={() => {
                setHomeHovered(true)
              }}
              onMouseLeave={() => {
                setHomeHovered(false)
              }}
            >
              <Text
                dimColor={!homeHovered}
                bold={homeHovered}
                color={homeHovered ? promptAccent : undefined}
              >
                {HOME_BUTTON_TEXT}
              </Text>
            </Box>
          )}
          <EffortChargeGlyph
            effort={channel.reasoningEffort}
            levels={channel.effortLevels}
            working={channel.working}
          />
          <Box
            ref={valueBoxRef}
            flexGrow={1}
            flexShrink={1}
            onClick={handleValueClick}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
          >
            {value.length === 0 ? (
              // Solid block caret on a BLANK cell: the terminal paints the
              // IME preedit (pinyin) at the physical cursor, which is parked
              // right here, so nothing else may occupy this cell.
              <>
                {caretCell('empty', ' ')}
                {/* 三幕点焰第二幕：空输入行居中短暂浮现档名大写（纯文
                    本流自带偏移空格——不引入嵌套 Box，行数恒定；有文字
                    时不显示）。3 = 行内 `❯ `（2 列）+ 空输入块光标（1
                    列）；行首 ⌂ 入口渲染时徽标之前还要多占它的列数。 */}
                <EffortTierBadge
                  effort={channel.reasoningEffort}
                  levels={channel.effortLevels}
                  columns={columns}
                  leadingColumns={3 + homeButtonCols}
                />
              </>
            ) : (
              <Box flexDirection="column">{rendered}</Box>
            )}
          </Box>
        </Box>
      </EffortInputBorder>
    </Box>
  )
}
