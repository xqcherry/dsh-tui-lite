import type { Publication } from '../state/module-store.js'

/** Connection is inert until the composition activates all module owners. */
export function createCommandLifetime<Host>(publication: Publication) {
  let host: Host | undefined
  let active = false
  let disposed = false
  return {
    connect(next: Host): void {
      if (disposed) throw new Error('Module lifetime has ended')
      if (host !== undefined) throw new Error('Module command host is already connected')
      host = next
    },
    start(): void {
      if (disposed) throw new Error('Module lifetime has ended')
      if (host === undefined) throw new Error('Module command host is not connected')
      if (active) throw new Error('Module commands are already active')
      active = true
    },
    call<Result>(work: (host: Host) => Result): Result {
      if (disposed) throw new Error('Module lifetime has ended')
      if (!active || host === undefined) throw new Error('Module commands are not active')
      const connected = host
      return publication.batch(() => work(connected))
    },
    dispose(): void { disposed = true; active = false; host = undefined },
  }
}
