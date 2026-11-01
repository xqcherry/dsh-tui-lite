/** FIFO and staged image ownership work without a running dsh. */
import assert from 'node:assert/strict'
import { createInputQueue } from '../src/modules/composer/model/input-queue.js'
import { createImageCapabilities } from '../src/modules/composer/model/image-capabilities.js'

let generation = 0
let alive = true
let release!: () => void
const seen: string[] = []
const queue = createInputQueue({
  capture: () => generation,
  current: origin => alive && origin === generation,
  captureImages: (_text, images) => images.map(value => ({ ...value })),
  async deliver(text) {
    seen.push(text)
    if (text === 'slow') await new Promise<void>(resolve => { release = resolve })
    if (text === 'fail') throw new Error('refused')
  },
  stale: () => { seen.push('stale') },
  failed: () => { seen.push('failed') },
  warn: () => { throw new Error('unexpected dispatch error') },
})
const drain = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
queue.dispatchUserText('slow', 'followup')
queue.dispatchUserText('old', 'followup')
await drain()
assert.deepEqual(seen, ['slow'])
assert.deepEqual(queue.activity(), { dispatched: 2, unsettled: true, parked: 'slow' })
generation++
queue.reset()
queue.dispatchUserText('new', 'followup')
await drain()
assert.deepEqual(seen, ['slow', 'new'])
release()
await drain()
assert.deepEqual(seen, ['slow', 'new', 'stale'])
queue.dispatchUserText('fail', 'followup')
queue.dispatchUserText('after', 'followup')
await drain()
assert.deepEqual(seen.slice(-3), ['fail', 'failed', 'after'])
assert.equal(queue.activity().unsettled, false)

let resolveImage!: (value: { attachment: string }) => void
const previews: string[] = []
const images = createImageCapabilities({
  generation: () => generation,
  assertActive: () => { assert(alive) },
  available: () => true,
  limits: () => undefined,
  persist: () => new Promise<{ attachment: string }>(resolve => { resolveImage = resolve }),
  preview: value => { previews.push(value); return undefined },
})
const input = { data: new Uint8Array([1]), mediaType: 'image/png' as const }
const before = images.stagedImageGeneration()
const pending = images.stageComposerImage(input, before)
generation++
resolveImage({ attachment: 'old-image' })
await assert.rejects(pending, /session changed/)
assert.equal(images.snapshot().size, 0)
assert.deepEqual(previews, [], 'stale persistence cannot create preview/path metadata')
const fresh = images.stageComposerImage(input, images.stagedImageGeneration())
resolveImage({ attachment: 'fresh-image' })
const handle = await fresh
assert.equal(images.hasStagedImage(handle.stageId), true)
assert.equal(images.snapshot().get(handle.stageId), 'fresh-image')
assert.deepEqual(previews, ['fresh-image'])
images.discardStagedImage(handle.stageId)
assert.equal(images.hasStagedImage(handle.stageId), false)
// Eviction removes capability and legacy bindings together; explicit draft
// references still outrank a same-label legacy binding.
const bounded = createImageCapabilities({
  generation: () => generation,
  assertActive: () => undefined,
  available: () => true,
  limits: () => undefined,
  persist: async (value) => ({ attachment: value.name ?? '' }),
})
const token = await bounded.stageImage({ ...input, name: 'first' })
const originalRefs = bounded.captureDraftImages(token, [])
const firstId = originalRefs[0]!.stageId
const explicit = [{ token, stageId: 'foreign' }]
assert.deepEqual(bounded.includeLegacyImageRefs(token, explicit), explicit)
for (let i = 0; i < 128; i++) await bounded.stageComposerImage({ ...input, name: String(i) }, bounded.stagedImageGeneration())
assert.equal(bounded.snapshot().size, 128)
assert.equal(bounded.hasStagedImage(firstId), false)
assert.deepEqual(bounded.includeLegacyImageRefs(token, []), [])
const copied = bounded.captureDraftImages(token, explicit)
explicit[0]!.stageId = 'mutated'
assert.equal(copied[0]!.stageId, 'foreign', 'enqueue refs do not share editable objects')
alive = false
assert.throws(() => images.stageComposerImage(input, images.stagedImageGeneration()))
console.log('Composer delivery passed: FIFO, stale origin, reset, failure continuation and image epochs')
