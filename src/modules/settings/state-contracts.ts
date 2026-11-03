import type { SkillInfo } from '../../shared/protocol/models.js'
import type { OAuthProviderStatus } from '../../shared/protocol/provider-settings.js'
import type { ProviderSetupHost } from '../../shared/protocol/provider-settings.js'
import type { CredentialStatus } from '../../shared/protocol/models.js'
import type { EffortOption } from '../../shared/protocol/models.js'
import type { LlmModelInfo } from '../../shared/protocol/models.js'
import type { LlmProviderInfo } from '../../shared/protocol/models.js'
import type { ReadableStore } from '../../shared/state/module-store.js'

export interface SettingsSnapshot {
  readonly model: string
  readonly provider: string
  readonly configuredProvider: string | undefined
  readonly configuredModel: string | undefined
  readonly configuredPreset: string | undefined
  readonly contextWindow: number | undefined
  readonly reasoningEffort: string | undefined
  readonly effortLevels: readonly string[] | undefined
  readonly thinkingFold: 'preview' | 'full'
  readonly promptSessionLabel: boolean
  readonly expandEditor: boolean
}

export interface SettingsCommands {
  switchModel(provider: string, model: string): Promise<boolean>
  listEfforts(): Promise<{ efforts: readonly EffortOption[]; defaultEffort: string | undefined; levelsFallback?: true }>
  setEffort(id: string): Promise<boolean>
  setDefaultEffort(id: string | undefined): void
  listModels(): Promise<readonly LlmModelInfo[]>
  listProviders(): Promise<readonly LlmProviderInfo[]>
  invalidateModelCompletion(): void
  describeCredential(ref: string): Promise<CredentialStatus | undefined>
  providerSetup(): ProviderSetupHost | undefined
  oauthProviderStatuses(): Promise<readonly OAuthProviderStatus[] | undefined>
  listSkills(): Promise<readonly SkillInfo[] | undefined>
}

export interface SettingsBinding {
  readonly store: ReadableStore<SettingsSnapshot>
  readonly commands: Readonly<SettingsCommands>
}
