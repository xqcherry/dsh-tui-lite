import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { AgentSession } from '../../agent/session.js'
import { t } from '../../i18n.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  firstStaleComposerToken,
  formatMissingReference,
  orderedComposerImages,
  type ComposerImages,
} from './composer-images.js'
import { expandComposerMentions } from './composer-mentions.js'
import { attachIdeSelection } from './ide-selection.js'
import { mentionAttachments, mentionFs } from './mentions.js'
import type { LocalImageStore } from './core/local-images.js'
import type { ChannelOwner } from './owner.js'
import type { ChannelSelection, SelectionAttachment } from '../../adapter/ports/channel-view.js'
import type {
  ChannelImageBlock,
  ChannelState,
  ComposerImageRef,
  MentionAttachments,
  MentionFs,
  PendingMessage,
  StagedImageInput,
} from './types.js'

/** One submission's enqueue-time world: the session it was typed in, the
 *  services that resolve its references, and the capabilities live then. */
export interface UserTextOrigin {
  readonly session: AgentSession
  readonly agentId: string
  readonly generation: number
  readonly cwd: string
  readonly fs: MentionFs | undefined
  readonly attachments: MentionAttachments | undefined
  /** The in-memory image store when the session takes images itself: the
   *  staged references resolve to its facades for `submit`. */
  readonly localImages?: LocalImageStore
  readonly stagedImages: ReadonlyMap<string, ChannelImageBlock['attachment']>
  /** Live editor selection AT ENQUEUE (undefined = none). Captured here so a
   *  selection made while the FIFO or mention expansion parks the delivery
   *  can never attach to this message. */
  readonly selection: ChannelSelection | undefined

}

/** Input FIFO, staged attachments and decision notice timers share one lifetime. */
export function createInputDelivery(
 ctx: Context, owner: ChannelOwner, binding: { readonly session: AgentSession },
 state: () => Pick<ChannelState, 'cwd' | 'agentId' | 'agentBindingGeneration'>,
 notify: ChannelState['notify'],
 trackPending: (message: { id: string; text: string; images?: readonly ComposerImageRef[] }, placement: PendingMessage['placement']) => void,
 untrackPending: (id: string) => void,
 composer: ComposerImages,
 selection: () => ChannelSelection | undefined,
 rememberSelection: (messageId: string, info: SelectionAttachment) => void,
 /** The fs surface to use when the host mounts no `fs` service (a non-DSH
  *  composition reads the local disk); absent = no fallback. */
 fallbackFs?: () => MentionFs | undefined,
 /** The in-memory image store of a session that takes images itself (the
  *  `images` capability); absent / undefined = the DSH attachments service. */
 localImages?: () => LocalImageStore | undefined,

) {
  /**
   * `@` file mentions (issue #15): expansion reads files asynchronously, so
   * every user-text delivery (submit / steer / interrupt-requeue) funnels
   * through this chain to keep the send order FIFO.
   */
  let inputChain: Promise<void> = Promise.resolve()
  /** Monotonic: inputs that entered the FIFO, and how many of them have
   *  left it (delivered, dropped or failed). `/new` compares them. */
  let dispatched = 0
  let settled = 0
  /** The texts still in the FIFO, oldest first (a switch names the parked one). */
  const inFlight: string[] = []

  /**
   * Attached-context registry (issue #842): `deliverUserText(..., attach)`
   * records the model-facing companion message under the DELIVERED user
   * message's id. The resident `agent/pre-step` listener below claims an entry
   * exactly once — on the step that admits its user message — and appends it
   * AFTER `next()`'s batch, the same shape and order as dsh-tool-skill's
   * gesture boundary. The map is emptied on claim, on inbox discard and on
   * channel release (owner.own below).
   */
  const attachedByMessageId = new Map<string, UserMessage>()

  /** Claim the batch's registered attachments, deleting each entry so a later
   *  step can never append it a second time. */
  const claimAttachments = (messages: readonly UserMessage[]): UserMessage[] => {
    if (attachedByMessageId.size === 0) return []
    const attached: UserMessage[] = []
    for (const message of messages) {
      const context = attachedByMessageId.get(message.id)
      if (context === undefined) continue
      attachedByMessageId.delete(message.id)
      attached.push(context)
    }
    return attached
  }

  /** Drop an attachment whose user message will never be claimed (inbox discard). */
  const retireAttachment = (messageId: string): void => {
    attachedByMessageId.delete(messageId)
  }

  /**
   * Resident `agent/pre-step` listener (D3/D4): `await next()` lets every
   * later transform run first; the waterfall applies AFTER-next transforms in
   * registration order, so registering at channel construction keeps this
   * append LAST (范例: presets/liangshen/instruction-hint.mjs). A rejected
   * step never claims — no context message without its admitted user line —
   * and a released owner returns the decision untouched. One `owner.own`
   * lifetime covers both the subscription and the whole registry (D5).
   */
  const disposePreStep = ctx.on('agent/pre-step', async (_payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    if (!owner.current()) return decision
    const attached = claimAttachments(decision.messages)
    if (attached.length === 0) return decision
    return { ...decision, messages: [...decision.messages, ...attached] }
  })
  owner.own(() => {
    disposePreStep()
    attachedByMessageId.clear()
  })

  /** Stale fence: the submission belongs to the session it was typed in (the
   *  bound session object plus the binding generation every adoption
   *  advances; works for any backend, no DSH agent needed). */
  const current = (origin: UserTextOrigin): boolean =>
    owner.current() && binding.session === origin.session && state().agentBindingGeneration === origin.generation

  /** D-6: bind the submission to the session it was typed in AT ENQUEUE
   *  TIME. The FIFO chain may park this task behind a slow predecessor
   *  while the user /new's away — capturing the agent at run time would
   *  adopt the NEW session as this text's origin and deliver the old
   *  conversation's words into it. */
  const captureOrigin = (): UserTextOrigin => {
    const local = localImages?.()
    return {
    session: binding.session,
    agentId: state().agentId,
    generation: state().agentBindingGeneration,
    cwd: state().cwd,
    fs: mentionFs(ctx) ?? fallbackFs?.(),
    attachments: local ?? mentionAttachments(ctx),
    ...(local === undefined ? {} : { localImages: local }),
    stagedImages: composer.snapshot(),
    selection: selection(),
    }
  }

  /**
   * Expand the text's `@` mentions and deliver ONE user message: the typed
   * text stays the first content block (the transcript bubble renders it —
   * never the file dump) and each resolved reference appends a model-facing
   * attachment block. The pending preview tracks the typed text.
   */
  const deliverUserText = async (
    text: string,
    placement: PendingMessage['placement'],
    images: readonly ComposerImageRef[],
    origin: UserTextOrigin,
    attach?: UserMessage,
  ): Promise<void> => {
    const orderedImages = orderedComposerImages(text, images, origin.stagedImages)
    // A `[Image #N]` placeholder whose staging was evicted (FIFO cap) or
    // whose draft capability was lost (history/rewind/session switch) would
    // otherwise ship as plain text with no image attached — warn loudly,
    // deliver unchanged (the text is the user's; rewriting is worse).
    const stale = firstStaleComposerToken(text, orderedImages)
    if (stale !== undefined) {
      notify(t('input-image-token-stale', { token: stale }), { color: 'warning', timeoutMs: 5000 })
    }
    const expansion = await expandComposerMentions(
      origin.fs,
      origin.cwd,
      text,
      origin.attachments,
      orderedImages,
    )
    // Mention reads can park for arbitrary I/O. A session switch during that
    // await invalidates the whole submission; neither the old nor the new
    // agent may receive a message assembled for a different conversation.
    if (!current(origin)) {
      notify(t('ext-stale-dropped'), { color: 'warning', timeoutMs: 4000 })
      return
    }
    // IDE selection consumption: append the ENQUEUE-time selection as its own
    // attached-file block — direct construction, never text parsing, failures
    // silently skipped (an IDE-side extra must never block a send).
    const selectionAttached = await attachIdeSelection(expansion.blocks, origin.cwd, origin.selection, origin.fs)
    const message = createUserMessage({
      content: expansion.blocks,
      source: { kind: 'user' },
    })
    if (selectionAttached !== undefined) rememberSelection(message.id, selectionAttached)
    // The message is real from here on: remember its attached context BEFORE
    // the submit so the pre-step listener can find it. A throwing submit
    // rolls both the pending preview and this entry back.
    if (attach !== undefined) attachedByMessageId.set(message.id, attach)
    // Track BEFORE the submit: a synchronous throw inside it rolls the
    // preview back; otherwise the backend's pending changes retire it once
    // the message is claimed or discarded.
    trackPending({ id: message.id, text, images }, placement)
    try {
      // The message id IS the clientMessageId every ledger above keys on; the
      // DSH session delivers this exact message (steer/followup).
      // A session that takes images itself reads them through their
      // in-memory facades, in block order.
      const local = origin.localImages
      const images = local === undefined ? undefined : expansion.blocks.flatMap(block => {
        if (block.type !== 'image') return []
        const view = local.facade(block.attachment)
        return view === undefined ? [] : [view]
      })
      await origin.session.submit({ text, blocks: message.content, clientMessageId: message.id, native: message, ...(images === undefined || images.length === 0 ? {} : { images }) }, placement)
    } catch (error) {
      if (attach !== undefined) attachedByMessageId.delete(message.id)
      untrackPending(message.id)
      throw error
    }
    if (expansion.attached.length > 0) {
      notify(t('mentions-attached', { count: expansion.attached.length }), { timeoutMs: 2500 })
    }
    if (expansion.missing.length > 0) {
      notify(t('mentions-missing', { paths: expansion.missing.map(formatMissingReference).join(' ') }), {
        color: 'warning',
        timeoutMs: 4000,
      })
    }
  }
  /** Deliver in submission order and reject work from a replaced binding. */
  const deliverQueuedUserText = async (
    text: string,
    placement: PendingMessage['placement'],
    images: readonly ComposerImageRef[],
    origin: UserTextOrigin,
    attach?: UserMessage,
  ): Promise<void> => {
    // Stale detection compares the SESSION REFERENCE, not the id: session ids
    // are reusable (A → /new → /resume A lands back on the same id with a
    // fresh session), so an id check has an ABA hole. Both origin values are
    // ENQUEUE-time captures (see dispatchUserText): a decision parked behind
    // a slow predecessor must still be judged against the session its text
    // was typed in, not whichever session is live when it finally runs.
    const dropIfStale = (): boolean => {
      if (current(origin)) return false
      notify(t('ext-stale-dropped'), { color: 'warning', timeoutMs: 4000 })
      return true
    }
    // A follower can wait behind an older slow decision while /new replaces
    // the session. Do not even expose that stale text to plugins.
    if (dropIfStale()) return
    try {
      await deliverUserText(text, placement, images, origin, attach)
    } catch (error: unknown) {
      // The FIFO must survive a failed expansion/send: surface it, then let
      // the next input proceed through the settled inputChain.
      const message = error instanceof Error ? error.message : String(error)
      logForDebugging(`submit: delivery failed (${message})`)
      notify(t('send-failed', { err: message }), { color: 'error' })
    }
  }
  const dispatchUserText = (
    text: string,
    placement: PendingMessage['placement'],
    images: readonly ComposerImageRef[] = [],
    attach?: UserMessage,
  ): void => {
    const origin = captureOrigin()
    const capturedImages = composer.captureDraftImages(text, images)
    dispatched += 1
    inFlight.push(text)
    inputChain = inputChain.then(() => deliverQueuedUserText(text, placement, capturedImages, origin, attach)).catch((error: unknown) => {
      // The chain must survive a failed decision: log, then continue with
      // the next queued submission.
      ctx.logger.warn('dsh-tui: tui/input dispatch failed: %o', error)
    }).finally(() => {
      settled += 1
      inFlight.shift()
    })
  }
  /** Public companion for callers that own a line but not a draft (skill
   *  registrations): same FIFO as a typed submit. The
   *  optional `attach` is registered by `deliverUserText` only once its user
   *  message is real, then appended at the end of that message's step batch. */
  const deliverUserTextNow = (
    text: string,
    placement: PendingMessage['placement'],
    images: readonly ComposerImageRef[] = [],
    attach?: UserMessage,
  ): void => dispatchUserText(text, placement, images, attach)
  /** Main's `clearStagedImages`: revoke capabilities AND release the FIFO so
   *  a task parked on the replaced session cannot wedge the new one. */
  const clearStagedImages = (): void => {
    composer.clearStagedImages()
    inputChain = Promise.resolve()
  }

  return {
    dispatchUserText,
    /** Inputs dispatched so far, and whether any is still in the FIFO (a
     *  parked decision, an `@` read, an IDE-selection read). */
    activity: (): { readonly dispatched: number; readonly unsettled: boolean; readonly parked?: string } => ({
      dispatched,
      unsettled: settled < dispatched,
      ...(inFlight[0] === undefined ? {} : { parked: inFlight[0] }),
    }),
    deliverUserText: deliverUserTextNow,
    claimAttachments,
    retireAttachment,
    clearStagedImages,
    stageImage: (input: StagedImageInput): Promise<string> => composer.stageImage(input),
    stagedImages: (): ReadonlyMap<string, ChannelImageBlock['attachment']> => composer.snapshot(),
    composer,
  }
}
