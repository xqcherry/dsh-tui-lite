import type { ProviderSetupHost } from '../../../../shared/protocol/provider-settings.js'

import { t } from '../../../../shared/i18n.js'


import { PROVIDER_PROTOCOLS } from './contracts.js'

import type { ProviderWizardDeps } from './contracts.js'


import type { RouteDiscovery } from './contracts.js'


export async function discoverRouteModels(
  host: ProviderSetupHost,
  draft: {
    provider?: string
    baseURL?: string
    api?: string
    apiKey?: string
    hasCustomHeaders?: boolean
  },
): Promise<RouteDiscovery> {
  const catalogResult = draft.provider !== undefined
    ? await host.discoverModels({ provider: draft.provider }).then(
      rows => ({ rows, catalog: 'fetched' as const }),
      () => ({ rows: [] as const, catalog: 'failed' as const }),
    )
    : { rows: [] as const, catalog: 'unavailable' as const }
  const catalogRows = catalogResult.rows
  const catalogIds = new Set(catalogRows.map(row => row.id))
  if (draft.baseURL === undefined || draft.baseURL === '') {
    return {
      rows: catalogRows,
      catalogIds,
      catalog: catalogResult.catalog,
      live: 'unavailable',
      reason: 'no-base-url',
    }
  }
  if (draft.hasCustomHeaders) {
    return {
      rows: catalogRows,
      catalogIds,
      catalog: catalogResult.catalog,
      live: 'unavailable',
      reason: 'custom-headers',
    }
  }
  const api = draft.api ?? (draft.provider !== undefined
    ? catalogLiveApi(draft.provider)
    : undefined)
  if (draft.provider !== undefined && api === undefined) {
    return {
      rows: catalogRows,
      catalogIds,
      catalog: catalogResult.catalog,
      live: 'unavailable',
      reason: 'unsupported-catalog',
    }
  }
  const live = await host.discoverModels({
    baseURL: draft.baseURL,
    ...(api !== undefined && api !== '' ? { api } : {}),
    ...(draft.apiKey !== undefined && draft.apiKey !== '' ? { apiKey: draft.apiKey } : {}),
  }).then(
    rows => ({ rows, live: 'fetched' as const }),
    () => ({ rows: [] as const, live: 'failed' as const }),
  )
  return {
    rows: [...catalogRows, ...live.rows.filter(row => !catalogIds.has(row.id))],
    catalogIds,
    catalog: catalogResult.catalog,
    live: live.live,
  }
}

export const CATALOG_LIVE_APIS: Readonly<Record<string, typeof PROVIDER_PROTOCOLS[number]>> = {
  deepseek: 'openai-completions',
  openai: 'openai-responses',
  anthropic: 'anthropic-messages',
}

export function catalogLiveApi(provider: string): typeof PROVIDER_PROTOCOLS[number] | undefined {
  return CATALOG_LIVE_APIS[provider]
}

export function notifyDiscoveryStatus(
  notify: ProviderWizardDeps['notify'],
  discovery: RouteDiscovery,
): void {
  if (discovery.catalog === 'failed') {
    notify(t('provider-catalog-fetch-failed'), { color: 'warning' })
  }
  if (discovery.live === 'failed') {
    notify(t('provider-live-fetch-failed'), { color: 'warning' })
  } else if (discovery.reason === 'unsupported-catalog' || discovery.reason === 'custom-headers') {
    notify(t('provider-live-fetch-unavailable'), { color: 'warning' })
  }
}
