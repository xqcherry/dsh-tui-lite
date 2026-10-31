


import type { ComposerImageRef } from '../../../shared/protocol/composer.js'


export interface DraftImageLease {
  readonly generation: number
  readonly revision: number
}

export const COMPOSER_IMAGE_TOKEN = /\[Image #\d+\]/gu

export /** Format label for one image media type, matching the image preview card's
 *  title (`JPEG`, `PNG`, `WEBP`, `GIF`). */
const mediaTypeLabel = (mediaType: string): string =>
  mediaType.replace(/^image\//u, '').replace(/\+xml$/u, '').toUpperCase()

export /** One `[Image #N]` occurrence: [start, end) offsets into the draft. */
interface ImageTokenSpan {
  readonly start: number
  readonly end: number
  readonly token: string
}

export /** Every `[Image #N]` in `text`, in order. */
function imageTokenSpans(text: string): ImageTokenSpan[] {
  const spans: ImageTokenSpan[] = []
  for (const match of text.matchAll(COMPOSER_IMAGE_TOKEN)) {
    const start = match.index ?? 0
    spans.push({ start, end: start + match[0].length, token: match[0] })
  }
  return spans
}

export /** The span whose interior (exclusive of both edges) contains `offset`. */
function imageTokenAround(spans: readonly ImageTokenSpan[], offset: number): ImageTokenSpan | undefined {
  return spans.find(span => span.start < offset && offset < span.end)
}

export /**
 * A caret never rests inside a staged token: an offset in a span's interior
 * moves to the edge `prefer` names — `'start'` (the token becomes the caret
 * cluster), `'end'`, or whichever is nearer.
 */
function snapOffImageToken(
  spans: readonly ImageTokenSpan[],
  offset: number,
  prefer: 'start' | 'end' | 'nearest',
): number {
  const span = imageTokenAround(spans, offset)
  if (span === undefined) return offset
  if (prefer === 'start') return span.start
  if (prefer === 'end') return span.end
  return offset - span.start < span.end - offset ? span.start : span.end
}

export /** Expand a deletion or selection to include every staged token it touches. */
function expandImageTokenRange(spans: readonly ImageTokenSpan[], start: number, end: number) {
  return {
    start: snapOffImageToken(spans, start, 'start'),
    end: snapOffImageToken(spans, end, 'end'),
  }
}

/** Capabilities referenced by `text`, in first occurrence order. A raw token
 * restored from disk/history has no sidecar entry and therefore stays inert. */
export function composerImageRefsForText(
  text: string,
  stagedByToken: ReadonlyMap<string, string>,
): ComposerImageRef[] {
  const refs: ComposerImageRef[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(COMPOSER_IMAGE_TOKEN)) {
    const token = match[0]
    if (seen.has(token)) continue
    seen.add(token)
    const stageId = stagedByToken.get(token)
    if (stageId !== undefined) refs.push({ token, stageId })
  }
  return refs
}
