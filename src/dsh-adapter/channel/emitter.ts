import { foldRows, MAX_ROWS } from '../../modules/transcript/index.js'
import type { ModuleOwners } from '../module-runtime.js'
import type { ChatRow } from './types.js'

/** Folding and deferred rows stay in the transcript owner's update scope. */
export function createChannelEmitter(
  state: Pick<ModuleOwners, 'transcript' | 'publication'>,
  beforeStream: () => boolean,
  options: { readonly fold?: boolean | (() => boolean); readonly restorable?: (row: ChatRow) => boolean } = {},
) {
  const fold = typeof options.fold === 'function' ? options.fold : () => options.fold !== false
  const cursor = { rows: undefined as unknown, index: 0, head: undefined as unknown }
  let disposed = false
  return {
    emit(mode: 'immediate' | 'stream' = 'immediate'): void {
      if (disposed) return
      state.publication.batch(() => {
        state.transcript.ingress.update(draft => {
          if (mode === 'immediate' && fold()) foldRows(draft.rows, MAX_ROWS, cursor, options.restorable)
        })
      }, mode)
    },
    flushStream(): void {
      if (disposed) return
      state.publication.batch(() => {
        beforeStream()
        state.transcript.ingress.update(draft => {
          if (fold()) foldRows(draft.rows, MAX_ROWS, cursor, options.restorable)
        })
      }, 'silent')
    },
    dispose(): void { disposed = true },
  }
}
