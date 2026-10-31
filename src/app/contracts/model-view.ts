

/**
 * Mutable channel state owned by {@link createChannel}: the screen's
 * reactive store. Screens subscribe and re-render on `version` bumps; the
 * fields mirror the public {@link Channel} contract, and the `@internal`
 * emit hooks belong to the implementation.
 */
/** One adapter-owned reasoning-effort level for the `/effort` slider. */
export interface EffortOption {
  id: string
  name: string
  description?: string
}

/**
 * Adapter-owned permission roster snapshot. `options` never contains the
 * official `custom` sentinel; it is represented only by `current`.
 */
export interface PermissionPresetSnapshot {
  readonly availability: PermissionPresetAvailability
  readonly options: readonly PermissionPresetOption[]
  readonly current?: PermissionPresetCurrent
}

export type PermissionPresetAvailability = 'runtime' | 'legacy' | 'unavailable'

export interface PermissionPresetOption {
  readonly value: string
  readonly name: string
  readonly description?: string
}

export interface PermissionPresetCurrent {
  readonly value: string
  readonly name: string
  readonly description?: string
  readonly kind: 'preset' | 'custom'
}

/** @internal */
/** One roster entry in the `/preset` picker (see {@link Channel.listPresets}). */
export interface PresetOption {
  id: string
  name?: string
  description?: string
  /** Present when the roster marked this preset unloadable (shown verbatim). */
  broken?: string
  isDefault: boolean
}

/** One skill in the live agent's catalog, for the `/skills` picker (issue #204). */
export interface SkillInfo {
  readonly name: string
  readonly description: string
  /** True when `/name` invokes it (it appears in the `/` menu, issue #86). */
  readonly userInvocable: boolean
  /** Discovery source bucket (bundled / user-* / project-* / runtime / …). */
  readonly source: string
}

/** Secret-free credential metadata for configuration and status surfaces. */
export interface CredentialStatus {
  configured: boolean
  source?: string
  writable: boolean
}
export interface LlmModelInfo { provider: string; id: string; name: string; description?: string; inputModalities?: readonly string[] }
export interface LlmProviderInfo { id: string; name: string }
export interface LlmDiscoveredModel { id: string; name?: string; contextWindow?: number; maxTokens?: number; inputModalities?: readonly string[] }
