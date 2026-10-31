import { stringWidth } from '../utils/stringWidth.js'

/** Wrap terminal text at word boundaries, including CJK input. */
export function wrapWidth(text: string, width: number): string[] {
  if (width <= 0) return []
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    let used = 0
    for (const char of paragraph) {
      const charWidth = stringWidth(char)
      if (used + charWidth > width) {
        // Prefer a word boundary, but only when it does not throw away most
        // of the line — a single long token must still make progress.
        const breakAt = line.lastIndexOf(' ')
        if (breakAt > width / 2) {
          lines.push(line.slice(0, breakAt))
          line = line.slice(breakAt + 1)
          used = stringWidth(line)
        } else {
          lines.push(line)
          line = ''
          used = 0
        }
      }
      line += char
      used += charWidth
    }
    lines.push(line)
  }
  return lines
}

/** Local clock for tool activity timestamps. */
export function formatClock(time: number): string {
  const date = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
