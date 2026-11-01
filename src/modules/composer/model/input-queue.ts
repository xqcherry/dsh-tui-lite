import type { ComposerImageRef, PendingMessage } from '../../../shared/protocol/composer.js'

/** One captured world per submission; the adapter alone interprets host resources. */
export interface InputQueueHost<Origin, Attachment> {
  capture(): Origin
  current(origin: Origin): boolean
  captureImages(text: string, images: readonly ComposerImageRef[]): readonly ComposerImageRef[]
  deliver(text: string, placement: PendingMessage['placement'], images: readonly ComposerImageRef[], origin: Origin, attach?: Attachment): Promise<void>
  stale(): void
  failed(error: unknown): void
  warn(error: unknown): void
}

export function createInputQueue<Origin, Attachment = never>(host: InputQueueHost<Origin, Attachment>) {
  let chain = Promise.resolve()
  let dispatched = 0
  let settled = 0
  const inFlight: string[] = []
  const dispatchUserText = (text: string, placement: PendingMessage['placement'], images: readonly ComposerImageRef[] = [], attach?: Attachment): void => {
    const origin = host.capture()
    const captured = host.captureImages(text, images)
    dispatched++
    inFlight.push(text)
    chain = chain.then(async () => {
      if (!host.current(origin)) { host.stale(); return }
      try { await host.deliver(text, placement, captured, origin, attach) }
      catch (error: unknown) { host.failed(error) }
    }).catch((error: unknown) => { host.warn(error) }).finally(() => {
      settled++
      inFlight.shift()
    })
  }
  return {
    dispatchUserText,
    reset(): void { chain = Promise.resolve() },
    activity: (): { readonly dispatched: number; readonly unsettled: boolean; readonly parked?: string } => ({
      dispatched, unsettled: settled < dispatched,
      ...(inFlight[0] === undefined ? {} : { parked: inFlight[0] }),
    }),
  }
}
