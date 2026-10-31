import type { ModuleOwners } from '../module-runtime.js'
import type { ContextOccupancy } from '../../shared/protocol/session.js'
import type { ComposerImageRef, PendingMessage } from './types.js'

/** Small mutable cells for Channel-local warning and pending-message state. */
export function createContextBookkeeping(
  state: () => Pick<ModuleOwners, 'composer' | 'transcript'>,
  notify: (text: string, options: { color: 'warning'; timeoutMs: number }) => unknown,
  lowContextText: (percent: number) => string,
  warningBufferTokens: number,
  readOccupancy?: () => ContextOccupancy | undefined,
) {
  const warning = { value: false }
  const checkContextWarning = (): void => {
    const channel = state()
    const occupancy = readOccupancy?.() ?? channel.transcript.ingress.read().contextOccupancy
    // No window (no route capacity) is the only reason to stay silent: the
    // numerator is now the projected occupancy, which exists as soon as a
    // meter (any normal deployment) or one settled request knows anything.
    if (warning.value || occupancy === undefined || occupancy.contextWindow === undefined) return
    if (occupancy.contextWindow <= 0) return
    const remaining = occupancy.contextWindow - occupancy.usedTokens
    if (remaining >= warningBufferTokens) return
    warning.value = true
    notify(lowContextText(Math.max(0, Math.round((remaining / occupancy.contextWindow) * 100))), {
      color: 'warning', timeoutMs: 8000,
    })
  }
  const trackPending = (message: { id: string; text: string; images?: readonly ComposerImageRef[] }, placement: PendingMessage['placement']): void => {
    const channel = state()
    channel.composer.ingress.update(draft => { draft.pending = [...draft.pending, { id: message.id, text: message.text, images: message.images ?? [], placement }] })
  }
  const untrackPending = (messageId: string): void => {
    const channel = state()
    channel.composer.ingress.update(draft => { draft.pending = draft.pending.filter(item => item.id !== messageId) })
  }
  const resetContextWarning = (): void => { warning.value = false }
  return { warning, resetContextWarning, checkContextWarning, trackPending, untrackPending }
}
