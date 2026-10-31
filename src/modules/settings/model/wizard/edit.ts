import type { ConfiguredProvider, ProfilePathOp } from '../../../../shared/protocol/provider-settings.js'

import { t } from '../../../../shared/i18n.js'
import { isQuestionInterruption } from '../../../../shared/protocol/question-interruption.js'
import type { QuestionAnswer as AskUserQuestionAnswer } from '../../../decisions/contracts.js'
import { isReservedCredentialRef } from '../credentialRefGuard.js'
import { CATALOG_MODEL_OVERRIDES_AVAILABLE, createProviderModelEditor, MODEL_CAPABILITY_FIELDS } from '../provider-model-capabilities.js'


import type { ProviderWizardDeps } from './contracts.js'
import type { ProviderWizardOutcome } from './contracts.js'

import { answerText } from './questions.js'
import { answerSelected } from './questions.js'

import { optionQuestion } from './questions.js'
import { textQuestion } from './questions.js'

import { buildEditMenuOptions } from './profiles.js'
import { sameModels } from './profiles.js'
import { providerRowDescription } from './profiles.js'
import { buildDeleteSummary } from './profiles.js'


import { mergeModelIds } from './questions.js'
import { modelCustomInput } from './questions.js'


import { discoverRouteModels } from './discovery.js'

import { catalogLiveApi } from './discovery.js'
import { notifyDiscoveryStatus } from './discovery.js'

import { modelRowDescription } from './profiles.js'
import { buildSummaryLines } from './profiles.js'


import { discoveredModelEntry } from './profiles.js'


export async function runEditWizard(
  deps: ProviderWizardDeps,
): Promise<ProviderWizardOutcome> {
  const { host, ask, notify } = deps
  const configured = host.listConfiguredProviders()
  if (configured.length === 0) {
    notify(t('provider-none-configured'), { color: 'warning' })
    return 'cancelled'
  }
  const pickAnswer = await ask({
    questions: [optionQuestion('edit-provider', t('provider-q-edit'), configured.map(provider => ({
      label: provider.route,
      description: providerRowDescription(provider),
    })), { hideCustomInput: true })],
  })
  const route = answerSelected(pickAnswer, 'edit-provider')[0]
  const existing = configured.find(row => row.route === route)
  if (existing === undefined) return 'cancelled'
  return runEditMenu(deps, existing)
}

export async function runEditMenu(
  deps: ProviderWizardDeps,
  provider: ConfiguredProvider,
): Promise<ProviderWizardOutcome> {
  const { ask, notify } = deps
  const menuAnswer = await ask({
    questions: [optionQuestion('edit-menu', t('provider-q-edit-menu', { route: provider.route }),
      buildEditMenuOptions(provider),
      { hideCustomInput: true })],
  })
  const picked = answerSelected(menuAnswer, 'edit-menu')[0]
  if (picked === t('provider-opt-edit-delete')) return deleteConfiguredProvider(deps, provider)
  if (picked === t('provider-opt-edit-key')) return editApiKey(deps, provider)
  if (picked === t('provider-opt-edit-baseurl')) return editBaseUrl(deps, provider)
  if (picked === t('provider-opt-edit-protocol')) return editWireProtocol(deps, provider)
  if (picked === t('provider-opt-edit-models')) return editModelList(deps, provider)
  notify(t('provider-edit-cancelled'))
  return 'cancelled'
}

export async function editApiKey(
  deps: ProviderWizardDeps,
  provider: ConfiguredProvider,
): Promise<ProviderWizardOutcome> {
  const { ask, notify, pushLocal, host } = deps
  if (provider.ref === '') {
    // No apiKeyEnv in the stored profile (externally-edited / legacy route):
    // there is no persisted credential to replace, so a store write under an
    // empty ref would never be read at request time.
    notify(t('provider-key-no-ref', { route: provider.route }), { color: 'warning' })
    return 'cancelled'
  }
  if (provider.shadowed) {
    // The environment provides the key: it cannot be edited from here and
    // a store write would never be read at request time anyway.
    notify(t('provider-key-env-not-editable', { route: provider.route, ref: provider.ref }),
      { color: 'warning' })
    return 'cancelled'
  }
  const keyAnswer = await ask({
    questions: [textQuestion('apikey', t('provider-q-apikey'), t('provider-q-apikey-detail'))],
  }, { redact: true })
  const value = answerText(keyAnswer, 'apikey')
  if (value === '') {
    notify(t('provider-key-empty'), { color: 'warning' })
    return 'cancelled'
  }
  // The ref is only a name: writing it replaces the key for EVERY profile
  // pointing at it (the all-layer census also covers base-inherited routes
  // the editable list never shows). Silently rotating a shared credential
  // would break those routes' auth, so the overwrite needs an explicit
  // opt-in naming the blast radius.
  const otherUsers = host.listRefUsers(provider.ref, provider.route)
  if (otherUsers.length > 0) {
    let overwriteAnswer: AskUserQuestionAnswer
    try {
      overwriteAnswer = await ask({
        questions: [optionQuestion('key-overwrite-confirm',
          t('provider-q-key-overwrite-confirm', { ref: provider.ref }), [
            { label: t('provider-opt-key-overwrite-yes') },
            { label: t('provider-opt-confirm-cancel') },
          ], {
            detail: t('provider-key-overwrite-warning', { routes: otherUsers.join(', ') }),
            hideCustomInput: true,
          })],
      })
    } catch (error) {
      if (isQuestionInterruption(error)) {
        notify(t('provider-edit-cancelled'))
        return 'cancelled'
      }
      throw error
    }
    if (answerSelected(overwriteAnswer, 'key-overwrite-confirm')[0] !== t('provider-opt-key-overwrite-yes')) {
      notify(t('provider-edit-cancelled'))
      return 'cancelled'
    }
  }
  await host.writeCredential(provider.ref, value)
  pushLocal('/provider', buildSummaryLines({
    route: provider.route,
    action: 'updated',
    ref: provider.ref,
    shadowed: provider.shadowed,
    baseURL: provider.baseURL,
    api: provider.api,
    models: provider.models ?? [],
    isCatalog: provider.isCatalog,
    keyLine: t('provider-line-key-updated', { ref: provider.ref }),
  }))
  notify(t('provider-edit-success', { route: provider.route }), { color: 'success' })
  return 'updated'
}

export async function patchProfileField(
  deps: ProviderWizardDeps,
  provider: ConfiguredProvider,
  path: readonly string[],
  value: unknown,
  /** Summary override for the field that changed; the others as stored. */
  change: { baseURL?: string; api?: string },
): Promise<ProviderWizardOutcome> {
  const { host, notify, pushLocal } = deps
  await host.mutateProfile(provider.route, [{ op: 'set', path, value }])
  pushLocal('/provider', buildSummaryLines({
    route: provider.route,
    action: 'updated',
    ref: provider.ref,
    shadowed: provider.shadowed,
    baseURL: change.baseURL ?? provider.baseURL,
    api: change.api ?? provider.api,
    models: provider.models ?? [],
    isCatalog: provider.isCatalog,
    keyLine: provider.ref !== ''
      ? t('provider-line-key-kept', { ref: provider.ref })
      : t('provider-line-key-none'),
  }))
  notify(t('provider-edit-success', { route: provider.route }), { color: 'success' })
  return 'updated'
}

export async function editBaseUrl(
  deps: ProviderWizardDeps,
  provider: ConfiguredProvider,
): Promise<ProviderWizardOutcome> {
  const { ask, notify } = deps
  const urlAnswer = await ask({
    questions: [textQuestion('baseurl', t('provider-q-baseurl'),
      provider.baseURL !== undefined
        ? t('provider-edit-current', { value: provider.baseURL })
        : undefined)],
  })
  const value = answerText(urlAnswer, 'baseurl')
  if (value === '') {
    notify(t('provider-edit-no-changes'))
    return 'cancelled'
  }
  return patchProfileField(deps, provider, ['baseURL'], value, { baseURL: value })
}

export async function editWireProtocol(
  deps: ProviderWizardDeps,
  provider: ConfiguredProvider,
): Promise<ProviderWizardOutcome> {
  const { ask, notify } = deps
  const current = provider.api ?? 'openai-completions'
  const protocolAnswer = await ask({
    questions: [optionQuestion('protocol', t('provider-q-protocol'), [
      { label: 'openai-completions', description: t('provider-protocol-completions-desc') },
      { label: 'openai-responses', description: t('provider-protocol-responses-desc') },
      { label: 'anthropic-messages', description: t('provider-protocol-anthropic-desc') },
    ], { hideCustomInput: true, defaultSelected: [current] })],
  })
  const picked = answerSelected(protocolAnswer, 'protocol')[0]
  if (picked === undefined || picked === current) {
    notify(t('provider-edit-no-changes'))
    return 'cancelled'
  }
  return patchProfileField(deps, provider, ['api'], picked, { api: picked })
}

export async function editModelList(
  deps: ProviderWizardDeps,
  provider: ConfiguredProvider,
): Promise<ProviderWizardOutcome> {
  const { host, ask, notify, pushLocal } = deps
  const isCatalog = provider.isCatalog
  const previous = provider.models ?? []
  // The credential is read only when a live probe will use it: a catalog
  // A route without a usable live probe (no endpoint, unsupported catalog
  // protocol, or custom headers the upstream seam cannot carry) stays on the
  // installed-catalog listing, so no secret is resolved for nothing.
  const endpointKnown = provider.baseURL !== undefined && provider.baseURL !== ''
  const liveProbePossible = endpointKnown
    && !provider.hasCustomHeaders
    && (!isCatalog || provider.api !== undefined || catalogLiveApi(provider.route) !== undefined)
  const key = provider.ref !== '' && liveProbePossible
    ? (provider.shadowed ? host.envValue(provider.ref) : await host.readCredential(provider.ref))
    : undefined
  notify(t('provider-discovery-running'))
  const discovery = await discoverRouteModels(host, {
    ...(isCatalog ? { provider: provider.route } : {}),
    ...(provider.baseURL !== undefined ? { baseURL: provider.baseURL } : {}),
    ...(provider.api !== undefined ? { api: provider.api } : {}),
    ...(provider.hasCustomHeaders ? { hasCustomHeaders: true } : {}),
    ...(key !== undefined ? { apiKey: key } : {}),
  })
  const discovered = discovery.rows
  notifyDiscoveryStatus(notify, discovery)

  const discoveredById = new Map(discovered.map(model => [model.id, model] as const))
  const storedById = new Map((provider.modelEntries ?? [])
    .flatMap(entry => typeof entry['id'] === 'string' ? [[entry['id'], entry] as const] : []))
  const entryFor = (id: string): Record<string, unknown> => storedById.get(id) ?? {
    ...discoveredModelEntry(id, isCatalog, discovery, discoveredById),
    ...provider.modelOverrides?.[id],
    id,
  }
  const capabilities = createProviderModelEditor(entryFor, discoveredById)
  let models: string[]
  if (discovered.length === 0 && previous.length === 0) {
    notify(t('provider-discovery-failed'), { color: 'warning' })
    const fallbackAnswer = await ask({
      questions: [textQuestion('models-fallback', t('provider-q-models-fallback'), undefined, capabilities.editor)],
    })
    models = mergeModelIds([], answerText(fallbackAnswer, 'models-fallback'))
    if (models.length === 0) {
      notify(t('provider-edit-no-changes'))
      return 'cancelled'
    }
  } else {
    if (discovered.length === 0) notify(t('provider-models-stored-only'), { color: 'warning' })
    // Existing models neither the catalog nor the endpoint advertises
    // (renamed, beta pulled, transient discovery gap) must still appear in
    // the panel, pre-checked and marked: options built from `discovered`
    // alone would silently drop them on an Enter-through confirm,
    // destroying their stored entries and the unmodeled per-model fields.
    // Only an explicit un-check removes one.
    const optionRows = discovered.map(model => ({
      label: model.id,
      description: modelRowDescription(
        model,
        isCatalog && discovery.catalog === 'fetched' && !discovery.catalogIds.has(model.id),
      ),
    }))
    const missingRows = previous
      .filter(id => !discoveredById.has(id))
      .map(id => ({
        label: id,
        description: t('provider-row-model-missing'),
      }))
    const modelsAnswer = await ask({
      questions: [optionQuestion('models', t('provider-q-models'),
        [...optionRows, ...missingRows],
        {
          multiSelect: true,
          defaultSelected: previous,
          modelEditor: capabilities.editor,
          ...(isCatalog && discovery.reason === 'no-base-url'
            ? { detail: t('provider-catalog-snapshot-note', { n: discovered.length }) }
            : {}),
        },
      )],
    })
    models = mergeModelIds(
      answerSelected(modelsAnswer, 'models'),
      modelCustomInput(modelsAnswer, isCatalog, discovery, notify),
    )
  }

  if (!isCatalog && models.length === 0) {
    // A manual route without models fails the adapter validation.
    notify(t('provider-models-required'), { color: 'error' })
    return 'cancelled'
  }
  const editedEntries = new Map([...capabilities.entries].filter(([id]) =>
    models.includes(id) || (isCatalog && models.length === 0 && discovery.catalogIds.has(id)),
  ))
  if (isCatalog && models.length === 0 && editedEntries.size > 0
    && !CATALOG_MODEL_OVERRIDES_AVAILABLE) {
    notify(t('provider-model-override-unavailable'), { color: 'warning' })
    return 'failed'
  }
  if (sameModels(models, previous) && editedEntries.size === 0) {
    notify(t('provider-edit-no-changes'))
    return 'cancelled'
  }
  const ops: ProfilePathOp[] = []
  if (isCatalog && models.length === 0) {
    if (previous.length > 0) ops.push({ op: 'set', path: ['models'], value: [] })
    // Keep the whole catalog served: editing one row must not turn it into
    // a one-model catalog. Only explicit field changes become overrides.
    for (const [id, entry] of editedEntries) {
      const original = entryFor(id)
      for (const field of MODEL_CAPABILITY_FIELDS) {
        if (JSON.stringify(entry[field]) === JSON.stringify(original[field])) continue
        const path = ['modelOverrides', id, field]
        ops.push(entry[field] === undefined ? { op: 'unset', path }
          : { op: 'set', path, value: entry[field] })
      }
    }
  } else {
    ops.push({ op: 'set', path: ['models'], value: models.map(id => editedEntries.get(id) ?? entryFor(id)) })
    // Upstream forbids modelOverrides beside an explicit models list. Carry
    // their fields into the entries before removing this alternate shape.
    if (provider.modelOverrides !== undefined && Object.keys(provider.modelOverrides).length > 0) {
      ops.push({ op: 'unset', path: ['modelOverrides'] })
    }
  }
  await host.mutateProfile(provider.route, ops)
  pushLocal('/provider', buildSummaryLines({
    route: provider.route,
    action: 'updated-models',
    ref: provider.ref,
    shadowed: provider.shadowed,
    baseURL: provider.baseURL,
    api: provider.api,
    models,
    isCatalog,
    keyLine: provider.ref !== ''
      ? t('provider-line-key-kept', { ref: provider.ref })
      : t('provider-line-key-none'),
    delta: {
      added: models.filter(id => !previous.includes(id)),
      removed: previous.filter(id => !models.includes(id)),
    },
    capabilityModels: [...editedEntries.keys()],
  }))
  notify(t('provider-edit-success', { route: provider.route }), { color: 'success' })
  return 'updated'
}

export async function deleteConfiguredProvider(
  deps: ProviderWizardDeps,
  provider: ConfiguredProvider,
): Promise<ProviderWizardOutcome> {
  const { host, ask, notify, pushLocal } = deps
  // A credential ref is only a name — several routes may share it, possibly
  // at settings layers the editable list never shows (a base-inherited
  // provider, or a consumer like the balance probe that resolves the ref
  // without any profile). The all-layer ref query is the only sound sharer
  // census: removing the key together with this route would silently break
  // every remaining consumer, so a shared key is kept — the confirm detail
  // says so up front and the transcript repeats it.
  const sharers = provider.ref === ''
    ? []
    : host.listRefUsers(provider.ref, provider.route)
  const previewLines = buildDeleteSummary(provider)
  let confirmAnswer: AskUserQuestionAnswer
  try {
    confirmAnswer = await ask({
      questions: [optionQuestion('delete-confirm', t('provider-q-delete-confirm', { route: provider.route }), [
        { label: t('provider-opt-delete-yes') },
        { label: t('provider-opt-confirm-cancel') },
      ], {
        detail: sharers.length > 0
          ? `${previewLines.join('\n')}\n${t('provider-delete-shared-warning', { ref: provider.ref, routes: sharers.join(', ') })}`
          : previewLines.join('\n'),
        hideCustomInput: true,
      })],
    })
  } catch (error) {
    if (isQuestionInterruption(error)) {
      notify(t('provider-delete-cancelled'))
      return 'cancelled'
    }
    throw error
  }
  if (answerSelected(confirmAnswer, 'delete-confirm')[0] !== t('provider-opt-delete-yes')) {
    notify(t('provider-delete-cancelled'))
    return 'cancelled'
  }

  try {
    await host.removeProfile(provider.route)
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error)
    notify(t('provider-delete-failed', { err }), { color: 'error', timeoutMs: 8000 })
    return 'failed'
  }

  // The catalog changed from here on: report 'deleted' whatever the
  // credential cleanup below does, so the caller invalidates completions.
  const pushedLines = [
    t('provider-line-action-deleted', { route: provider.route }),
    ...previewLines.slice(1),
  ]
  let keyCleanupFailed = false
  if (provider.ref !== '') {
    if (provider.shadowed) {
      pushedLines.push(t('provider-line-deleted-key-shadowed', { ref: provider.ref }))
    } else if (isReservedCredentialRef(provider.ref)) {
      // Host-owned credential namespace (the harness's own main key lives
      // here): never removed as a side effect of deleting a route.
      pushedLines.push(t('provider-line-deleted-key-reserved', { ref: provider.ref }))
    } else {
      // Reference re-check AFTER the profile unset, not the pre-confirm
      // census: the store may have gained or lost users while the confirm
      // was up (and a route whose user-layer override was just cleared can
      // re-inherit a base profile still pointing at the ref). The route is
      // gone from the merged section, so no exclusion is needed — any hit
      // here is a live consumer. When the running settings layer cannot
      // answer the query at all, treat the ref as shared and keep it: an
      // unremovable key is recoverable, a destroyed one is not.
      let remaining: readonly string[]
      try {
        remaining = host.listRefUsers(provider.ref)
      } catch {
        remaining = [t('provider-unknown-ref-users')]
      }
      if (remaining.length > 0) {
        pushedLines.push(t('provider-line-deleted-key-shared',
          { ref: provider.ref, routes: remaining.join(', ') }))
      } else {
        try {
          await host.removeCredential(provider.ref)
          pushedLines.push(t('provider-line-deleted-key', { ref: provider.ref }))
        } catch {
          keyCleanupFailed = true
          pushedLines.push(t('provider-line-deleted-key-cleanup-failed', { ref: provider.ref }))
        }
      }
    }
  }
  pushLocal('/provider', pushedLines)
  if (keyCleanupFailed) {
    notify(t('provider-delete-key-cleanup-failed', { route: provider.route, ref: provider.ref }),
      { color: 'warning', timeoutMs: 8000 })
  } else {
    notify(t('provider-delete-success', { route: provider.route }), { color: 'success' })
  }
  return 'deleted'
}
