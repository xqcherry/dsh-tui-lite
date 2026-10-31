/**
 * Minimal shared-projector harness for translator gates: six real module owners plus recording projector deps, so a script can
 * fold translated `AgentEvent`s through the production reducer
 * (`src/modules/transcript/model/projection.ts`) and inspect the resulting rows/state without
 * mounting a channel. The golden pipeline keeps its own richer harness
 * (scripts/lib/projection-golden.ts); this one is for focused assertions.
 *
 * Import from TypeScript scripts run with `node --import tsx/esm`.
 */
import type { AgentEvent } from '../../src/shared/protocol/events.js'
import { createRuntimeModulesFixture, readRuntimeFixture } from './runtime-modules-fixture.js'
import type { RuntimeModules } from '../../src/dsh-adapter/module-runtime.js'

type Projection = ReturnType<RuntimeModules['transcript']['ingress']['createProjection']>

export interface ProjectorHarness {
  readonly state: ReturnType<typeof readRuntimeFixture>
  readonly runtime: RuntimeModules
  readonly projector: Projection
  readonly notices: string[]
  /** Fold one live batch (or a replay batch with `replay: true`). */
  apply(events: readonly AgentEvent[], replay?: boolean): void
}

export function createProjectorHarness(options: { agentPreset?: string; thinkingFold?: 'preview' | 'full'; model?: string; now?: () => number } = {}): ProjectorHarness {
  const runtime = createRuntimeModulesFixture(options)
  const notices: string[] = []
  const rowIds = { value: 0 }
  const notify = (text: string): (() => void) => {
    notices.push(text)
    return () => undefined
  }
  const projector = runtime.transcript.ingress.createProjection({
    sessions: runtime.sessions,
    settings: runtime.settings,
    composer: runtime.composer,
  }, {
    rowIds,
    resetContextWarning: () => undefined,
    checkContextWarning: () => undefined,
    notify: text => {
      notices.push(text)
      return () => undefined
    },
    jobs: { onOutputSeen: () => undefined, onStarted: () => undefined },
    inputConvergence: { cancelInFlight: false },
    selectionAttached: () => undefined,
  })
  return {
    runtime,
    get state() { return readRuntimeFixture(runtime) },
    projector,
    notices,
    apply(events, replay = false) {
      projector.apply(events, { replay })
    },
  }
}
