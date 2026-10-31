/** Real module owners for source regressions; no adapter-wide mutable state. */
import { createSessionsModule } from '../../src/modules/sessions/model/module.js'
import { createSettingsModule } from '../../src/modules/settings/model/module.js'
import { createComposerModule } from '../../src/modules/composer/model/module.js'
import { createTranscriptModule } from '../../src/modules/transcript/model/module.js'
import { createActivityModule } from '../../src/modules/activity/model/module.js'
import { createWorkbenchModule } from '../../src/modules/workbench/model/module.js'
import { createPublication } from '../../src/shared/state/module-store.js'
import type { RuntimeModules } from '../../src/dsh-adapter/module-runtime.js'
import type { ModuleLaunch } from '../../src/shared/protocol/module-launch.js'
import type { SessionsCommands } from '../../src/modules/sessions/contracts.js'
import type { SettingsCommands } from '../../src/modules/settings/contracts.js'
import type { ComposerCommands } from '../../src/modules/composer/contracts.js'
import type { TranscriptCommands } from '../../src/modules/transcript/contracts.js'
import type { ActivityCommands } from '../../src/modules/activity/contracts.js'
import type { WorkbenchCommands } from '../../src/modules/workbench/contracts.js'

interface FixtureCommands {
  sessions?: Partial<SessionsCommands>
  settings?: Partial<SettingsCommands>
  composer?: Partial<ComposerCommands>
  transcript?: Partial<TranscriptCommands>
  activity?: Partial<ActivityCommands>
  workbench?: Partial<WorkbenchCommands>
}

/** Unprovided commands stay absent so an unexpected invocation fails loudly. */
export function createRuntimeModulesFixture(options: {
  model?: string
  agentPreset?: string
  thinkingFold?: 'preview' | 'full'
  commands?: FixtureCommands
} = {}): RuntimeModules {
  const launch: ModuleLaunch = {
    options: { model: options.model ?? 'fixture-model', provider: 'fixture', cwd: '/fixture', agentPreset: options.agentPreset },
    input: { agentId: 'fixture-agent', sessionId: 'fixture-session', mode: { id: 'normal', label: 'Normal' }, cwdDescription: '/fixture' },
  }
  const publication = createPublication()
  const commands = options.commands ?? {}
  const sessions = createSessionsModule(launch, (commands.sessions ?? {}) as SessionsCommands, publication)
  const settings = createSettingsModule(launch, (commands.settings ?? {}) as SettingsCommands, publication)
  const composer = createComposerModule(launch, (commands.composer ?? {}) as ComposerCommands, publication)
  const transcript = createTranscriptModule(launch, (commands.transcript ?? {}) as TranscriptCommands, publication)
  const activity = createActivityModule(launch, (commands.activity ?? {}) as ActivityCommands, publication)
  const workbench = createWorkbenchModule(launch, (commands.workbench ?? {}) as WorkbenchCommands, publication)
  settings.ingress.patch({ thinkingFold: options.thinkingFold ?? 'preview' })
  return {
    sessions, settings, composer, transcript, activity, workbench, publication,
    dispose() {
      publication.dispose()
      for (const module of [sessions, settings, composer, transcript, activity, workbench]) module.dispose()
    },
  }
}

/** Read-only aggregate for legacy regression assertions, never reducer input. */
export function readRuntimeFixture(runtime: RuntimeModules) {
  return {
    ...runtime.sessions.store.getSnapshot(),
    ...runtime.settings.store.getSnapshot(),
    ...runtime.composer.store.getSnapshot(),
    ...runtime.transcript.store.getSnapshot(),
    ...runtime.activity.store.getSnapshot(),
    ...runtime.workbench.store.getSnapshot(),
  }
}
