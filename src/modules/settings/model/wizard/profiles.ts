import type { ConfiguredProvider, OAuthProviderStatus } from '../../../../shared/protocol/provider-settings.js'
import type { LlmDiscoveredModel } from '../../../../shared/protocol/models.js'
import { t } from '../../../../shared/i18n.js'


import type { RouteDiscoveryCatalog } from './contracts.js'

import type { RouteDiscovery } from './contracts.js'


export function deriveKeyRef(route: string): string {
  return `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

export function buildEditMenuOptions(provider: ConfiguredProvider): { label: string; description?: string }[] {
  const isCatalog = provider.isCatalog
  const options: { label: string; description?: string }[] = [
    { label: t('provider-opt-edit-key'),
      ...(provider.shadowed ? { description: t('provider-row-key-shadowed') } : {}) },
  ]
  if (!isCatalog) {
    options.push(
      { label: t('provider-opt-edit-baseurl'), description: provider.baseURL },
      { label: t('provider-opt-edit-protocol'), description: provider.api },
    )
  }
  options.push(
    { label: t('provider-opt-edit-models'),
      description: provider.models !== undefined && provider.models.length > 0
        ? t('provider-row-models', { n: provider.models.length })
        : t('provider-row-catalog') },
    { label: t('provider-opt-edit-delete'), description: t('provider-opt-edit-delete-desc') },
  )
  return options
}

export function sameModels(a: readonly string[], b: readonly string[] | undefined): boolean {
  if (b === undefined) return a.length === 0
  return a.length === b.length && b.every(id => a.includes(id))
}

export function providerRowDescription(provider: ConfiguredProvider): string {
  const parts: string[] = []
  if (provider.baseURL !== undefined) parts.push(provider.baseURL)
  parts.push(provider.models !== undefined && provider.models.length > 0
    ? t('provider-row-models', { n: provider.models.length })
    : t('provider-row-catalog'))
  if (provider.shadowed) parts.push(t('provider-row-key-shadowed'))
  return parts.join(' · ')
}

export function buildDeleteSummary(provider: ConfiguredProvider): string[] {
  const lines = [t('provider-line-route', { route: provider.route })]
  if (provider.baseURL !== undefined && provider.baseURL !== '') {
    const endpoint = t('provider-line-endpoint', { url: provider.baseURL })
    lines.push(provider.api !== undefined && provider.api !== ''
      ? `${endpoint} · ${provider.api}`
      : endpoint)
  }
  lines.push(modelsSummaryLine(provider.models ?? [], undefined))
  if (provider.ref !== '') {
    lines.push(provider.shadowed
      ? t('provider-line-keyref-env', { ref: provider.ref })
      : t('provider-line-keyref', { ref: provider.ref }))
  }
  return lines
}

export function oauthStateDescription(status: OAuthProviderStatus): string {
  if (status.signedIn) {
    return status.expiresAt === undefined
      ? t('provider-oauth-state-in-no-expiry')
      : t('provider-oauth-state-in', { time: new Date(status.expiresAt).toISOString() })
  }
  return status.expired
    ? t('provider-oauth-state-expired')
    : (status.loginLabel ?? status.oauthLabel)
}

export function formatCapacity(n: number): string {
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}M`
  if (n >= 1_000 && n % 1_000 === 0) return `${n / 1_000}k`
  return `${n}`
}

export function modelRowDescription(model: LlmDiscoveredModel, isNew: boolean): string | undefined {
  const parts = [
    ...(isNew ? [t('provider-row-model-new')] : []),
    ...(model.name !== undefined && model.name !== '' ? [model.name] : []),
    ...(model.contextWindow !== undefined ? [formatCapacity(model.contextWindow)] : []),
  ]
  return parts.length > 0 ? parts.join(' · ') : undefined
}

export function buildSummaryLines(input: {
  route: string
  /** Outcome verb for the first line (what this run actually did). */
  action: 'added' | 'updated' | 'updated-models' | 'preview'
  ref: string
  shadowed: boolean
  baseURL: string | undefined
  api: string | undefined
  models: readonly string[]
  isCatalog: boolean
  /** Key line override (kept / updated / env); add mode derives it. */
  keyLine?: string
  /** Model-list delta against the previously enabled set (model-list edits). */
  delta?: { added: readonly string[]; removed: readonly string[] }
  capabilityModels?: readonly string[]
}): string[] {
  const lines = [input.action === 'preview'
    ? t('provider-line-route', { route: input.route })
    : input.action === 'added'
    ? t('provider-line-action-added', { route: input.route })
    : input.action === 'updated-models'
      ? t('provider-line-action-updated-models', { route: input.route })
      : t('provider-line-action-updated', { route: input.route })]
  lines.push((input.action === 'preview' && !input.shadowed && input.ref !== ''
    ? t('provider-line-keyref-preview', { ref: input.ref })
    : undefined) ?? input.keyLine ?? (input.shadowed
    ? t('provider-line-keyref-env', { ref: input.ref })
    : t('provider-line-keyref', { ref: input.ref })))
  if (input.baseURL !== undefined && input.baseURL !== '') {
    // The wire protocol rides the endpoint line: it only ever varies per
    // endpoint, and a lone protocol row reads as filler.
    const endpoint = t('provider-line-endpoint', { url: input.baseURL })
    lines.push(input.api !== undefined && input.api !== ''
      ? `${endpoint} · ${input.api}`
      : endpoint)
  }
  lines.push(modelsSummaryLine(input.models, input.delta))
  if (input.capabilityModels !== undefined && input.capabilityModels.length > 0) {
    lines.push(t('provider-line-model-capabilities', { models: input.capabilityModels.join(', ') }))
  }
  return lines
}

export function modelsSummaryLine(
  models: readonly string[],
  delta: { added: readonly string[]; removed: readonly string[] } | undefined,
): string {
  const base = models.length > 0
    ? t('provider-line-models', { models: models.join(', ') })
    : t('provider-line-models-catalog')
  if (delta === undefined) return base
  const parts: string[] = []
  if (delta.added.length > 0) parts.push(t('provider-models-delta-added', { n: delta.added.length }))
  if (delta.removed.length > 0) parts.push(t('provider-models-delta-removed', { n: delta.removed.length }))
  return parts.length === 0 ? base
    : `${base}${t('provider-models-delta-wrap', { parts: parts.join(' · ') })}`
}

export function capsOf(model: LlmDiscoveredModel | undefined): Record<string, number> {
  if (model === undefined) return {}
  return {
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
  }
}

export function discoveredModelEntry(
  id: string,
  isCatalog: boolean,
  discovery: Pick<RouteDiscovery, 'catalog' | 'catalogIds'>,
  discoveredById: ReadonlyMap<string, LlmDiscoveredModel>,
): Record<string, unknown> {
  return {
    id,
    ...((isCatalog && (discovery.catalog !== 'fetched' || discovery.catalogIds.has(id)))
      ? {} : capsOf(discoveredById.get(id))),
  }
}

export function buildProfile(input: {
  isCatalog: boolean
  ref: string
  baseURL: string | undefined
  api: string | undefined
  models: readonly string[]
  discoveredById: ReadonlyMap<string, LlmDiscoveredModel>
  catalogIds: ReadonlySet<string>
  catalogDiscovery: RouteDiscoveryCatalog
  capabilityEntries: ReadonlyMap<string, Record<string, unknown>>
}): Record<string, unknown> {
  const profile: Record<string, unknown> = {}
  // Preserve the profile's credential shape: an empty ref (no apiKeyEnv)
  // must not be rewritten as `apiKeyEnv: ''`.
  if (input.ref !== '') profile['apiKeyEnv'] = input.ref
  if (input.baseURL !== undefined && input.baseURL !== '') profile['baseURL'] = input.baseURL
  if (input.isCatalog) {
    // `models` replaces the catalog when present; omit it to keep the whole
    // catalog served. An id the installed catalog covers stays plain `{id}`
    // (the catalog carries versioned capabilities); an endpoint-only id
    // carries what the live listing disclosed.
    if (input.models.length > 0) {
      profile['models'] = input.models.map(id => input.capabilityEntries.get(id) ?? ({
        id,
        ...((input.catalogDiscovery !== 'fetched' || input.catalogIds.has(id))
          ? {}
          : capsOf(input.discoveredById.get(id))),
      }))
    } else {
      const overrides = [...input.capabilityEntries]
        .filter(([id]) => input.catalogIds.has(id))
        .map(([id, entry]) => [id, Object.fromEntries(Object.entries(entry).filter(([field]) => field !== 'id'))])
      if (overrides.length > 0) profile['modelOverrides'] = Object.fromEntries(overrides)
    }
    return profile
  }
  profile['api'] = input.api
  profile['models'] = input.models.map(id => input.capabilityEntries.get(id) ?? ({
    id,
    ...capsOf(input.discoveredById.get(id)),
  }))
  return profile
}
