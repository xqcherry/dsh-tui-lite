import type { SessionsSnapshot } from '../../modules/sessions/contracts.js'
import type { Notify } from '../../shared/protocol/notifications.js'
import { createInputQueue } from '../../modules/composer/index.js'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { ChannelSelection, SelectionAttachment } from '../../shared/protocol/composer.js'
import { t } from '../../shared/i18n.js'
import type { ChannelOwner } from '../../shared/lifecycle/owner.js'
import { logForDebugging } from '../../shared/platform/debug.js'
import type { DshSession as AgentSession } from '../backend/session.js'
import {
  firstStaleComposerToken,
  formatMissingReference,
  orderedComposerImages,
  type ComposerImages,
} from './composer-images.js'
import { expandComposerMentions } from './composer-mentions.js'
import { attachIdeSelection } from './ide-selection.js'
import { mentionAttachments, mentionFs } from './mentions.js'
import type {
  ChannelImageBlock,
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
  readonly stagedImages: ReadonlyMap<string, ChannelImageBlock['attachment']>
  /** Live editor selection AT ENQUEUE (undefined = none). Captured here so a
   *  selection made while the FIFO or mention expansion parks the delivery
   *  can never attach to this message. */
  readonly selection: ChannelSelection | undefined

}

/** Input FIFO, staged attachments and decision notice timers share one lifetime. */
export function createInputDelivery(
 ctx: Context, owner: ChannelOwner, binding: { readonly session: AgentSession },
 session: () => Readonly<Pick<SessionsSnapshot, 'agentBindingGeneration' | 'agentId' | 'cwd'>>,
 notify: Notify,
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

) {
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
    owner.current() && binding.session === origin.session && session().agentBindingGeneration === origin.generation

  /** D-6: bind the submission to the session it was typed in AT ENQUEUE
   *  TIME. The FIFO chain may park this task behind a slow predecessor
   *  while the user /new's away — capturing the agent at run time would
   *  adopt the NEW session as this text's origin and deliver the old
   *  conversation's words into it. */
  const captureOrigin = (): UserTextOrigin => {
    return {
    session: binding.session,
    agentId: session().agentId,
    generation: session().agentBindingGeneration,
    cwd: session().cwd,
    fs: mentionFs(ctx) ?? fallbackFs?.(),
    attachments: mentionAttachments(ctx),
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
      await origin.session.submit({ text, blocks: message.content, clientMessageId: message.id, native: message }, placement)
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
  const queue = createInputQueue<UserTextOrigin, UserMessage>({
    capture: captureOrigin,
    current,
    captureImages: (text, images) => composer.captureDraftImages(text, images),
    deliver: deliverUserText,
    stale: () => { notify(t('ext-stale-dropped'), { color: 'warning', timeoutMs: 4000 }) },
    failed(error) {
      const message = error instanceof Error ? error.message : String(error)
      logForDebugging(`submit: delivery failed (${message})`)
      notify(t('send-failed', { err: message }), { color: 'error' })
    },
    warn: error => { ctx.logger.warn('dsh-tui: tui/input dispatch failed: %o', error) },
  })
  const { dispatchUserText } = queue
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
    queue.reset()
  }

  return {
    dispatchUserText,
    /** Inputs dispatched so far, and whether any is still in the FIFO (a
     *  parked decision, an `@` read, an IDE-selection read). */
    activity: queue.activity,
    deliverUserText: deliverUserTextNow,
    claimAttachments,
    retireAttachment,
    clearStagedImages,
    stageImage: (input: StagedImageInput): Promise<string> => composer.stageImage(input),
    stagedImages: (): ReadonlyMap<string, ChannelImageBlock['attachment']> => composer.snapshot(),
    composer,
  }
}
