


import { graphemeBoundaries } from './editing.js'

import { imageTokenSpans, imageTokenAround } from './image-tokens.js'


import { getGraphemeSegmenter } from '../../../shared/platform/intl.js'

import { stringWidth } from '../../../shared/platform/stringWidth.js'


export const HOME_BUTTON_TEXT = '⌸ '

export const HOME_BUTTON_COLS = stringWidth(HOME_BUTTON_TEXT)

export const FOLD_MIN_LINES = 6

export const FOLD_MIN_CHARS = 600

export const isBigInput = (text: string): boolean =>
  text.split('\n').length >= FOLD_MIN_LINES || text.length >= FOLD_MIN_CHARS

export const MAX_VISIBLE_LINES = 5

export const DOUBLE_CLICK_MS = 500

export function wrapLineRows(
  line: string,
  width: number,
): Array<{ start: number; end: number }> {
  if (line === '') return [{ start: 0, end: 0 }]
  const rows: Array<{ start: number; end: number }> = []
  const segmenter = getGraphemeSegmenter()
  // The space inside `[Image #N]` is not a break opportunity: the token is
  // one unit on screen (its caret cluster and chip styling span it), so it
  // wraps whole, like a word.
  const unbreakable = imageTokenSpans(line)
  let rowStart = 0
  let currentWidth = 0
  let offset = 0
  let lastBreak = -1
  for (const { segment } of segmenter.segment(line)) {
    const w = stringWidth(segment)
    while (currentWidth + w > width && offset > rowStart) {
      if (lastBreak > rowStart) {
        rows.push({ start: rowStart, end: lastBreak })
        rowStart = lastBreak
        currentWidth = stringWidth(line.slice(rowStart, offset))
        lastBreak = -1
      } else {
        rows.push({ start: rowStart, end: offset })
        rowStart = offset
        currentWidth = 0
        lastBreak = -1
      }
    }
    currentWidth += w
    offset += segment.length
    if (segment === ' ' && imageTokenAround(unbreakable, offset) === undefined) lastBreak = offset
  }
  rows.push({ start: rowStart, end: offset })
  return rows
}

export function wrapToWidth(text: string, width: number): string[] {
  return text.split('\n').flatMap(line =>
    wrapLineRows(line, width).map(r => line.slice(r.start, r.end)),
  )
}

export function caretInText(
  text: string,
  width: number,
  offset: number,
): { line: number; charCol: number; visualCol: number } {
  let line = 0
  let lineBase = 0
  let last = { line: 0, charCol: 0, visualCol: 0 }
  for (const logical of text.split('\n')) {
    for (const r of wrapLineRows(logical, width)) {
      const start = lineBase + r.start
      const charCol = Math.max(0, offset - start)
      last = {
        line,
        charCol,
        visualCol: stringWidth(logical.slice(r.start, r.start + charCol)),
      }
      if (offset <= lineBase + r.end) return last
      line++
    }
    lineBase += logical.length + 1
  }
  return last
}

export function clickToCursorOffset(
  text: string,
  width: number,
  visualLine: number,
  visualCol: number,
  snapWithin: 'nearest' | 'grapheme-start' = 'nearest',
): number {
  const segmenter = getGraphemeSegmenter()
  let row = 0
  let lineBase = 0
  for (const line of text.split('\n')) {
    for (const r of wrapLineRows(line, width)) {
      if (row === visualLine) {
        let currentWidth = 0
        let local = 0
        for (const { segment } of segmenter.segment(line.slice(r.start, r.end))) {
          const w = stringWidth(segment)
          // Caret positioning uses the nearest edge. Double-click selection
          // instead needs the grapheme UNDER the cell: on the second cell of a
          // CJK/emoji glyph, nearest-edge would point after the glyph (and the
          // final glyph would select nothing).
          if (snapWithin === 'grapheme-start' && currentWidth + w > visualCol) {
            return lineBase + r.start + local
          }
          if (currentWidth + w / 2 > visualCol) return lineBase + r.start + local
          if (currentWidth + w > visualCol) return lineBase + r.start + local + segment.length
          currentWidth += w
          local += segment.length
        }
        return lineBase + r.end
      }
      row++
    }
    lineBase += line.length + 1
  }
  return lineBase
}

export function visualLineRanges(text: string, width: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let lineBase = 0
  for (const line of text.split('\n')) {
    for (const r of wrapLineRows(line, width)) ranges.push([lineBase + r.start, lineBase + r.end])
    lineBase += line.length + 1
  }
  return ranges
}

export const WORD_CHAR = /[\p{L}\p{N}_/.\-+~\\]/u

export function selectionCharClass(c: string): 0 | 1 | 2 {
  if (c === '' || /\s/.test(c)) return 0
  if (WORD_CHAR.test(c)) return 1
  return 2
}

export function wordSelectionAt(
  text: string,
  offset: number,
  lo: number,
  hi: number,
): { start: number; end: number } | null {
  if (offset < lo || offset >= hi) return null
  const bounds = graphemeBoundaries(text.slice(lo, hi)).map(b => b + lo)
  let i = 0
  while (i < bounds.length - 1 && bounds[i + 1]! <= offset) i++
  const clusterAt = (index: number): string => text.slice(bounds[index]!, bounds[index + 1]!)
  const cls = selectionCharClass(clusterAt(i))
  let a = i
  while (a > 0 && selectionCharClass(clusterAt(a - 1)) === cls) a--
  let b = i
  while (b < bounds.length - 2 && selectionCharClass(clusterAt(b + 1)) === cls) b++
  return { start: bounds[a]!, end: bounds[b + 1]! }
}
