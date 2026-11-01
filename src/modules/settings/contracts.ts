export type { ModelRoute } from './model/modelRoute.js'

export type { OAuthProviderStatus } from './model/providerWizard.js'

export type { OAuthSetupHost } from './model/providerWizard.js'

export type { ProfilePathOp } from './model/providerWizard.js'

export type { ProviderSetupHost } from './model/providerWizard.js'

export type { ModelActions } from './model/actions-contract.js'

export type { SettingsSnapshot, SettingsCommands, SettingsBinding } from './state-contracts.js'

export type SettingsMetadataEvent = Extract<import('../../shared/protocol/events.js').AgentEvent, { type: 'context.capacity' | 'session.ready' | 'model.changed' | 'effort.changed' | 'request.header' }>

export interface SettingsProjectionIngress {
  projectionContext(): Readonly<Pick<import('./state-contracts.js').SettingsSnapshot, 'thinkingFold' | 'model' | 'reasoningEffort'>>
  metadata(event: SettingsMetadataEvent): void
}

/** Route and capacity state belongs to the settings module at adoption. */
export interface SettingsSessionIngress {
  adoptRoute(route: import('./model/modelRoute.js').ModelRoute | undefined): void
  resetSessionCapabilities(): void
}

export type { SettingsModelInfo, SettingsModelCatalog, SettingsModelState, SettingsModelHost } from './model/model-actions.js'

/** Host capabilities consumed by the settings command owner. */
export type SettingsCommandHost = import('./state-contracts.js').SettingsCommands
