import type { OAuthProviderStatus, ProviderSetupHost } from '../../../shared/protocol/provider-settings.js'
import type { CredentialStatus, EffortOption, LlmModelInfo, LlmProviderInfo, PermissionPresetSnapshot } from '../../../shared/protocol/models.js'

/** ModelActions: client-owned operations. */
export interface ModelActions {
  /** Switch the live model (`/model` picker): forks the conversation at its
   *  current end and continues it with a new agent routed to `provider`/`model`.
   *  The history replays unchanged; only the request route changes. */
  switchModel(provider: string, model: string): Promise<boolean>
  /** The live route's effort levels + adapter default for the `/effort`
   *  slider; empty `efforts` after notifying when unsupported/unavailable.
   *  `levelsFallback` is true when the ladder is the CLI-standard
   *  compatibility offer (the model row declares no tiers of its own) —
   *  the slider marks it as such instead of implying the model's list. */
  listEfforts(): Promise<{ efforts: readonly EffortOption[]; defaultEffort: string | undefined; levelsFallback?: true }>
  /** Set one effort level by id (validated against the adapter list);
   *  false + a notify when the id is not offered. Persists like the old
   *  Shift+Tab cycle (~/.dsh-tui/effort.json). */
  setEffort(id: string): Promise<boolean>
  /** Re-seat the future-sessions default reasoning effort (cordis.yml
   *  `effort` → persisted /effort choice → adapter default). The live agent
   *  is re-pinned too when its route offers the level, so a change lands on
   *  its next request. */
  setDefaultEffort(id: string | undefined): void
  /** Shift+Tab: advance to the next configured session mode. */
  cycleMode(): Promise<void>
  /** Read the official permission preset roster and current identity. */
  permissionPresets(): PermissionPresetSnapshot
  /**
   * TUI-side permission preset switch: drives the durable `permission/preset`
   * path (the same handler the command drives). Resolves true when the
   * durable identity confirms the target. Never falls through to the model.
   */
  runPermissionPreset(name: string): Promise<boolean>
  /** Advertised models across every registered provider route (empty when the LLM service is absent). */
  listModels(): Promise<readonly LlmModelInfo[]>
  /** Provider display identities for the same routes (picker group labels). */
  listProviders(): Promise<readonly LlmProviderInfo[]>
  /** Drop the `/model <provider/id>` completion cache so the next `/model `
   *  refetch reflects a provider-catalog change (`/provider` add/edit/delete,
   *  OAuth sign-in/out) — the same consistency the picker's per-open refetch
   *  already provides. */
  invalidateModelCompletion(): void
  /** Safe credential metadata for `/login`; undefined without the service. */
  describeCredential(ref: string): Promise<CredentialStatus | undefined>
  /** Runtime capabilities for the `/provider` wizard, over the settings /
   *  credentials / llm seams; undefined when the composition lacks them
   *  (bare cordis.yml start without the dsh-base services). */
  providerSetup(): ProviderSetupHost | undefined
  /** OAuth sign-in states from a mounted dsh-auth-style plugin; undefined
   *  without the plugin, so `/login` renders exactly what it did before. */
  oauthProviderStatuses(): Promise<readonly OAuthProviderStatus[] | undefined>
}
