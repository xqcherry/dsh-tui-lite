import type { SessionModeSpec } from '../../shared/protocol/display.js'
import type { ProviderSetupHost } from '../../shared/protocol/provider-settings.js'
import type { EffortOption } from '../../shared/protocol/models.js'
import type { LlmModelInfo } from '../../shared/protocol/models.js'
import type { PermissionPresetSnapshot } from '../../shared/protocol/models.js'

/** Explicit SettingsPort capability; no access to unrelated client operations. */
export interface SettingsPort {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string | undefined
  readonly effortLevels: readonly string[] | undefined
  readonly mode: SessionModeSpec
  listModels(): Promise<readonly LlmModelInfo[]>
  switchModel(provider: string, model: string): Promise<boolean>
  listEfforts(): Promise<{ efforts: readonly EffortOption[]; defaultEffort: string | undefined; levelsFallback?: true }>
  setEffort(id: string): Promise<boolean>
  permissionPresets(): PermissionPresetSnapshot
  runPermissionPreset(name: string): Promise<boolean>
  providerSetup(): ProviderSetupHost | undefined
}

export type { ModelRoute } from './model/modelRoute.js'

export type { OAuthProviderStatus } from './model/providerWizard.js'

export type { OAuthSetupHost } from './model/providerWizard.js'

export type { ProfilePathOp } from './model/providerWizard.js'

export type { ProviderSetupHost } from './model/providerWizard.js'

export type { ModelActions } from './model/actions-contract.js'
