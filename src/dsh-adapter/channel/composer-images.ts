import type { Context } from '@deepseek-ai/cordis'
import type { ChannelOwner } from '../../shared/lifecycle/owner.js'
import type { AdaptOutcome, ImageSizeProbe, ResizeLimits } from '../../shared/platform/imageResize.js'
import { adaptImageForAdmission, probeImageSize, withinDimensionLimits } from '../../shared/platform/imageResize.js'
import { createImageCapabilities, type ComposerImages as ImageCapabilities } from '../../modules/composer/index.js'
import { rememberImagePath, transcriptImageFromAttachment } from '../transcript-images.js'
import { mentionAttachments } from './mentions.js'
import type { ChannelImageBlock, StagedImageAdjustment, StagedImageInput } from './types.js'

export { COMPOSER_IMAGE_TOKEN, COMPOSER_IMAGE_TOKEN_EXACT, orderedComposerImages, firstStaleComposerToken, formatMissingReference } from '../../modules/composer/index.js'
export type ComposerImages = ImageCapabilities<ChannelImageBlock['attachment']>
export type { ComposerImageLimits } from '../../modules/composer/contracts.js'

/** Failure text for a refusal the ingress gate can state before the store:
 *  every reason except a missing sharp describes an image the deployment
 *  would reject anyway, so the paste is refused with the cause named. */
function admissionFailure(
  outcome: Extract<AdaptOutcome, { kind: 'unavailable' }>,
  context: { readonly probe: ImageSizeProbe | null; readonly mediaType: string; readonly limits: ResizeLimits },
): string {
  switch (outcome.reason) {
    case 'sharp-missing':
      return context.probe !== null
        ? `image is ${context.probe.width}×${context.probe.height} (over ${context.limits.maxImageDimension}px) and sharp is unavailable to resample it`
        : `${context.mediaType} is not accepted by this profile and sharp is unavailable to convert it`
    case 'animated-unsupported':
      return `resizing or converting this animated image cannot keep its frames (${outcome.detail})`
    default:
      return `image could not be decoded to resize or convert it (${outcome.detail})`
  }
}

/** A store-reported pixel dimension, or the gate's own value when the store
 *  reported none (lean attachment fakes in the verify scripts). */
const positiveOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && value > 0 ? value : fallback

/** Host image admission and persistence; editable capabilities live in composer. */
export function createComposerImages(ctx: Context, owner: ChannelOwner, deps: { generation(): number }): ComposerImages {
  return createImageCapabilities({
    generation: deps.generation,
    assertActive: owner.assertActive,
    available: () => mentionAttachments(ctx) !== undefined,
    limits: () => {
      const limits = mentionAttachments(ctx)?.imageLimits
      return limits === undefined ? undefined : {
        maxImageBytes: limits.maxImageBytes, maxImagesPerMessage: limits.maxImagesPerMessage,
        maxImageDimension: limits.maxImageDimension, maxImagePixels: limits.maxImagePixels,
      }
    },
    preview(attachment, input) {
      if (input.path !== undefined) rememberImagePath(String(attachment.attachmentId), input.path)
      return transcriptImageFromAttachment(attachment, () => ctx.get('attachments'))
    },
    async persist(input: StagedImageInput) {
      const attachments = mentionAttachments(ctx)
      if (attachments === undefined) throw new Error('image attachments are unavailable in this profile')
      if (input.data.byteLength > attachments.imageLimits.maxImageBytes) {
        throw new Error(`image exceeds this profile's per-image size limit`)
      }
      // Ingress adaptation (issue #938): the store admits by media type, byte
      // budget and the per-side / total pixel caps, and refuses on all of them
      // when the bytes reach it. Measure and re-encode HERE instead, while the
      // paste can still be explained to the user. Admission is judged against
      // the pair this gate HANDS OVER (the store may normalize further on its
      // own — that step is outside this feature), and both triggers are
      // size-independent:
      //   * a source media type the profile does not accept is converted, so a
      //     small PNG is never refused while a large one succeeds;
      //   * a probe-recognized image inside the caps skips sharp entirely;
      //   * an unrecognized format is decoded for measurement (never trusted by
      //     byte budget alone — the #432 gap);
      //   * with sharp absent the image goes to the store unchanged ONLY while
      //     it is still admissible as-is — an accepted format whose size the
      //     probe could not prove fits (upstream stays the backstop); a measured
      //     oversize, a decode failure, an unaccepted format or a multi-frame
      //     image this gate would have to re-encode is reported now instead of
      //     becoming a token that dies at save time.
      // The runtime guards keep older attachment fakes (whose imageLimits
      // predate the dimension fields) on the legacy synchronous path.
      const dimensionCap = attachments.imageLimits.maxImageDimension
      const pixelCap = attachments.imageLimits.maxImagePixels
      let mediaType = input.mediaType
      let data = input.data
      let adapted: Extract<AdaptOutcome, { kind: 'adapted' }> | undefined
      if (typeof dimensionCap === 'number' && typeof pixelCap === 'number'
        && Number.isFinite(dimensionCap) && Number.isFinite(pixelCap)) {
        const dimensionLimits = { maxImageDimension: dimensionCap, maxImagePixels: pixelCap }
        const probe = probeImageSize(data)
        const sourceAccepted = attachments.imageLimits.mediaTypes.includes(mediaType)
        // Only a probe-measured oversize is *known* to be refused by the store;
        // an unmeasurable image may well be admissible, which is what keeps the
        // sharp-less degradation a degradation rather than a guess.
        const knownOversize = probe !== null && !withinDimensionLimits(probe, dimensionLimits)
        if (!sourceAccepted || probe === null || knownOversize) {
          const outcome = await adaptImageForAdmission(
            data,
            mediaType,
            dimensionLimits,
            attachments.imageLimits.mediaTypes,
          )
          if (outcome.kind === 'adapted') {
            // outcome.mediaType comes from the accepted list inside the gate, so
            // it is one of the profile's media types at runtime — narrowing,
            // not trusting.
            mediaType = outcome.mediaType as typeof mediaType
            data = outcome.data
            adapted = outcome
            if (data.byteLength > attachments.imageLimits.maxImageBytes) {
              throw new Error(`image still exceeds this profile's per-image size limit after resampling`)
            }
          } else if (outcome.kind === 'unavailable') {
            // Degrade ONLY when the paste is still admissible as-is: an accepted
            // format whose size the probe could not prove fits. Everything else
            // (measured oversize, unaccepted format, decode failure, animation
            // that cannot survive) is a refusal we can state now.
            const degraded = outcome.reason === 'sharp-missing' && sourceAccepted && !knownOversize
            if (!degraded) throw new Error(admissionFailure(outcome, { probe, mediaType, limits: dimensionLimits }))
          }
        }
      }
      // What the store will actually see: an accepted media type, inside the
      // byte cap. A media type can still be unaccepted here only when the
      // adaptation did not run (legacy limits) or could not produce one.
      if (!attachments.imageLimits.mediaTypes.includes(mediaType)) {
        throw new Error(`${mediaType} images are not accepted by this profile`)
      }
      // The source path is TUI-side display metadata; the store only sees the
      // fields its contract names. mediaType/data may be the adapted pair from
      // the ingress gate above.
      const { path, ...stored } = input
      const attachment = await attachments.saveImage({ ...stored, mediaType, data })
      // The adjustment travels with the capability so the composer can say what
      // happened instead of letting a rewritten image reach the store silently.
      // Its numbers come from the STORE's own report, not from what this gate
      // handed over: the store normalizes further (dimensions, and the media type
      // too), and a notice quoting the gate's numbers would contradict the
      // preview card the user is looking at.
      const adjustment: StagedImageAdjustment | undefined = adapted === undefined ? undefined : {
        sourceMediaType: input.mediaType,
        mediaType: attachment.mediaType,
        width: positiveOr(attachment.width, adapted.width),
        height: positiveOr(attachment.height, adapted.height),
        resized: adapted.resized
          || positiveOr(attachment.width, adapted.width) !== adapted.width
          || positiveOr(attachment.height, adapted.height) !== adapted.height,
        flattened: adapted.flattened,
      }
      return { attachment, ...(adjustment === undefined ? {} : { adjustment }) }
    },
  })
}
