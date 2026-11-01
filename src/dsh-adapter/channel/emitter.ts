import type { Publication } from '../../shared/state/module-store.js'
import type { ChatRow } from './types.js'

/** Folding and deferred rows stay in the transcript owner's update scope. */
export function createChannelEmitter(
  ports: {
    batch: Publication['batch']
    prepareEmission(fold: boolean, restorable?: (row: Readonly<ChatRow>) => boolean): void
  },
  beforeStream: () => boolean,
  options: { readonly fold?: boolean | (() => boolean); readonly restorable?: (row: ChatRow) => boolean } = {},
) {
  const fold = typeof options.fold === 'function' ? options.fold : () => options.fold !== false
  let disposed = false
  return {
    emit(mode: 'immediate' | 'stream' = 'immediate'): void {
      if (disposed) return
      ports.batch(() => {
        ports.prepareEmission(mode === 'immediate' && fold(), options.restorable)
      }, mode)
    },
    flushStream(): void {
      if (disposed) return
      ports.batch(() => {
        beforeStream()
        ports.prepareEmission(fold(), options.restorable)
      }, 'silent')
    },
    dispose(): void { disposed = true },
  }
}
