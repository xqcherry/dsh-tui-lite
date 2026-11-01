import type { createSessionsModule } from '../modules/sessions/index.js'
import type { createSettingsModule } from '../modules/settings/index.js'
import type { createComposerModule } from '../modules/composer/index.js'
import type { createTranscriptModule } from '../modules/transcript/index.js'
import type { createActivityModule } from '../modules/activity/index.js'
import type { createWorkbenchModule } from '../modules/workbench/index.js'
import type { Publication } from '../shared/state/module-store.js'

/** Composition names owners; each owner keeps its own writer. */
export interface ModuleOwners {
  readonly sessions: ReturnType<typeof createSessionsModule>
  readonly settings: ReturnType<typeof createSettingsModule>
  readonly composer: ReturnType<typeof createComposerModule>
  readonly transcript: ReturnType<typeof createTranscriptModule>
  readonly activity: ReturnType<typeof createActivityModule>
  readonly workbench: ReturnType<typeof createWorkbenchModule>
  readonly publication: Publication
}

/** Resource lifetime and six independent module owners. */
export interface RuntimeModules extends ModuleOwners {
  dispose(): void
}

const publishers = new WeakMap<object, (mode: 'immediate' | 'stream') => void>()
export function bindRuntimePublisher(runtime: object, publish: (mode: 'immediate' | 'stream') => void): void {
  publishers.set(runtime, publish)
}
export function publishRuntime(runtime: Pick<ModuleOwners, 'transcript' | 'publication'>, mode: 'immediate' | 'stream' = 'immediate'): void {
  const publish = publishers.get(runtime)
  if (publish) publish(mode)
  else runtime.publication.batch(() => runtime.transcript.ingress.touch(), mode)
}
