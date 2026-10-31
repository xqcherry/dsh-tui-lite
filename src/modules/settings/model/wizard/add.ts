

import { t } from '../../../../shared/i18n.js'


import { CATALOG_MODEL_OVERRIDES_AVAILABLE, createProviderModelEditor } from '../provider-model-capabilities.js'


import { deriveKeyRef } from './profiles.js'
import type { ProviderWizardDeps } from './contracts.js'
import type { ProviderWizardOutcome } from './contracts.js'
import { MAX_RETRY } from './contracts.js'
import { answerText } from './questions.js'
import { answerSelected } from './questions.js'

import { optionQuestion } from './questions.js'
import { textQuestion } from './questions.js'


import { runOAuthWizard } from './oauth.js'
import { promptRouteId } from './questions.js'
import { mergeModelIds } from './questions.js'
import { modelCustomInput } from './questions.js'


import { discoverRouteModels } from './discovery.js'


import { notifyDiscoveryStatus } from './discovery.js'

import { modelRowDescription } from './profiles.js'
import { buildSummaryLines } from './profiles.js'


import { discoveredModelEntry } from './profiles.js'
import { buildProfile } from './profiles.js'

export async function runAddFlow(
  deps: ProviderWizardDeps,
): Promise<ProviderWizardOutcome> {
  const { host, ask, notify, pushLocal } = deps

  // ── 1. mode ────────────────────────────────────────────────────────
  const modeOptions = [
    { label: t('provider-opt-catalog'), description: t('provider-opt-catalog-desc') },
    { label: t('provider-opt-custom'), description: t('provider-opt-custom-desc') },
  ]
  // The OAuth branch exists only while a dsh-auth-style plugin is mounted;
  // without the service the mode question stays exactly two options.
  if (host.oauth !== undefined) {
    modeOptions.push({ label: t('provider-opt-oauth'), description: t('provider-opt-oauth-desc') })
  }
  const modeAnswer = await ask({
    questions: [optionQuestion('mode', t('provider-q-mode'), modeOptions, { hideCustomInput: true })],
  })
  const pickedMode = answerSelected(modeAnswer, 'mode')[0]
  if (host.oauth !== undefined && pickedMode === t('provider-opt-oauth')) {
    return runOAuthWizard(deps, host.oauth)
  }
  const isCatalog = pickedMode === t('provider-opt-catalog')

  // ── 2. route ───────────────────────────────────────────────────────
  let route = ''
  if (isCatalog) {
    const candidates = host.listCatalogProviders()
    if (candidates.length > 0) {
      const otherLabel = t('provider-opt-other-route')
      const catalogAnswer = await ask({
        questions: [optionQuestion('catalog', t('provider-q-catalog'), [
          ...candidates.map(candidate => ({
            label: candidate.provider,
            description: candidate.displayName === candidate.provider
              ? undefined
              : candidate.displayName,
          })),
          { label: otherLabel, description: t('provider-opt-other-route-desc') },
        ], { hideCustomInput: true })],
      })
      const pick = answerSelected(catalogAnswer, 'catalog')[0]
      if (pick !== undefined && pick !== otherLabel) route = pick
    }
  }
  if (route === '') {
    route = await promptRouteId(ask, notify)
    if (route === '') return 'cancelled'
  }

  // ── 3. API key (own batch so redact covers exactly the secret) ─────
  const ref = deriveKeyRef(route)
  const shadowed = host.envShadows(ref)
  const keyAnswer = await ask({
    questions: [textQuestion('apikey', t('provider-q-apikey'), t('provider-q-apikey-detail'))],
  }, { redact: true })
  const apiKey = answerText(keyAnswer, 'apikey')
  const keyLine = shadowed
    ? t('provider-line-keyref-env', { ref })
    : t('provider-line-keyref', { ref })

  // ── 4. endpoint / protocol ─────────────────────────────────────────
  let baseURL: string | undefined
  let api: string | undefined
  if (isCatalog) {
    const choiceAnswer = await ask({
      questions: [optionQuestion('baseurl-choice', t('provider-q-baseurl-choice'), [
        { label: t('provider-opt-baseurl-skip') },
        { label: t('provider-opt-baseurl-input') },
      ], { hideCustomInput: true })],
    })
    if (answerSelected(choiceAnswer, 'baseurl-choice')[0] === t('provider-opt-baseurl-input')) {
      const urlAnswer = await ask({
        questions: [textQuestion('baseurl', t('provider-q-baseurl'))],
      })
      baseURL = answerText(urlAnswer, 'baseurl')
    }
  } else {
    const endpointAnswer = await ask({
      questions: [
        textQuestion('baseurl', t('provider-q-baseurl')),
        optionQuestion('protocol', t('provider-q-protocol'), [
          { label: 'openai-completions', description: t('provider-protocol-completions-desc') },
          { label: 'openai-responses', description: t('provider-protocol-responses-desc') },
          { label: 'anthropic-messages', description: t('provider-protocol-anthropic-desc') },
        ], { hideCustomInput: true }),
      ],
    })
    baseURL = answerText(endpointAnswer, 'baseurl')
    api = answerSelected(endpointAnswer, 'protocol')[0]
  }

  // ── 5. model discovery (draft credential, nothing persisted) ───────
  notify(t('provider-discovery-running'))
  const discovery = await discoverRouteModels(host, {
    ...(isCatalog ? { provider: route } : {}),
    ...(baseURL !== undefined && baseURL !== '' ? { baseURL } : {}),
    ...(api !== undefined ? { api } : {}),
    ...(apiKey !== undefined && apiKey !== '' ? { apiKey } : {}),
  })
  const discovered = discovery.rows
  notifyDiscoveryStatus(notify, discovery)

  // ── 6. model selection ─────────────────────────────────────────────
  let models: string[] = []
  const discoveredById = new Map(discovered.map(model => [model.id, model] as const))
  const capabilities = createProviderModelEditor(
    id => discoveredModelEntry(id, isCatalog, discovery, discoveredById),
    discoveredById,
  )
  if (discovered.length > 0) {
    const modelsAnswer = await ask({
      questions: [optionQuestion('models', t('provider-q-models'),
        discovered.map(model => ({
          label: model.id,
          description: modelRowDescription(
            model,
            isCatalog && discovery.catalog === 'fetched' && !discovery.catalogIds.has(model.id),
          ),
        })),
        {
          multiSelect: true,
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
  } else {
    notify(t('provider-discovery-failed'), { color: 'warning' })
    for (let attempt = 0; attempt < MAX_RETRY && models.length === 0; attempt += 1) {
      const fallbackAnswer = await ask({
        questions: [textQuestion('models-fallback', t('provider-q-models-fallback'), undefined, capabilities.editor)],
      })
      models = mergeModelIds([], answerText(fallbackAnswer, 'models-fallback'))
      if (models.length === 0) notify(t('provider-models-required'), { color: 'warning' })
    }
    if (models.length === 0) return 'cancelled'
  }
  if (!isCatalog && models.length === 0) {
    // A manual route without models fails the adapter validation; the
    // loops above should prevent this, but guard before writing.
    notify(t('provider-models-required'), { color: 'error' })
    return 'cancelled'
  }

  const wholeCatalogCapabilityEdits = [...capabilities.entries.keys()]
    .filter(id => models.includes(id) || (isCatalog && models.length === 0 && discovery.catalogIds.has(id)))
  if (isCatalog && models.length === 0 && wholeCatalogCapabilityEdits.length > 0
    && !CATALOG_MODEL_OVERRIDES_AVAILABLE) {
    notify(t('provider-model-override-unavailable'), { color: 'warning' })
    return 'failed'
  }

  // ── 7. confirm ─────────────────────────────────────────────────────
  const summaryLines = buildSummaryLines({
    route, action: 'added', ref, shadowed, baseURL, api, models, isCatalog, keyLine,
    capabilityModels: wholeCatalogCapabilityEdits,
  })
  const previewLines = buildSummaryLines({
    route, action: 'preview', ref, shadowed, baseURL, api, models, isCatalog, keyLine,
    capabilityModels: wholeCatalogCapabilityEdits,
  })
  const detail = host.routeExists(route)
    ? `${previewLines.join('\n')}\n${t('provider-route-exists-warning')}`
    : previewLines.join('\n')
  const confirmAnswer = await ask({
    questions: [optionQuestion('confirm', t('provider-q-confirm'), [
      { label: t('provider-opt-confirm-write') },
      { label: t('provider-opt-confirm-cancel') },
    ], { detail, hideCustomInput: true })],
  })
  if (answerSelected(confirmAnswer, 'confirm')[0] !== t('provider-opt-confirm-write')) {
    notify(t('provider-cancelled'))
    return 'cancelled'
  }

  // ── 8. persist: credential first (rollbackable), then the profile ──
  let wroteCredential = false
  let previousCredential: string | undefined
  if (!shadowed && apiKey !== undefined) {
    // Capture any pre-existing value BEFORE overwriting: when the profile
    // write below fails, rollback must restore it — an unconditional unset
    // would destroy the old key of the route being overwritten.
    previousCredential = await host.readCredential(ref)
    await host.writeCredential(ref, apiKey)
    wroteCredential = true
  }
  const profile = buildProfile({
    isCatalog,
    ref,
    baseURL,
    api,
    models,
    discoveredById,
    catalogIds: discovery.catalogIds,
    catalogDiscovery: discovery.catalog,
    capabilityEntries: capabilities.entries,
  })
  try {
    await host.writeProfile(route, profile)
  } catch (error) {
    if (wroteCredential) {
      try {
        if (previousCredential !== undefined) {
          await host.writeCredential(ref, previousCredential)
        } else {
          await host.removeCredential(ref)
        }
        notify(t('provider-rollback-ok'))
      } catch {
        notify(t('provider-rollback-failed'), { color: 'warning' })
      }
    }
    const err = error instanceof Error ? error.message : String(error)
    notify(t('provider-write-failed', { err }), { color: 'error', timeoutMs: 8000 })
    return 'failed'
  }

  // ── 9. success: transcript summary + optional live switch ──────────
  pushLocal('/provider', [
    ...summaryLines,
    ...(deps.working() || models.length === 0
      ? [t('provider-switch-hint')]
      : []),
  ])
  notify(t('provider-success', { route }), { color: 'success' })

  if (!deps.working() && models.length > 0) {
    const target = models[0]!
    const switchAnswer = await ask({
      questions: [optionQuestion('switch', t('provider-q-switch'), [
        { label: t('provider-opt-switch-now', { model: target }) },
        { label: t('provider-opt-switch-keep') },
      ], { hideCustomInput: true })],
    })
    if (answerSelected(switchAnswer, 'switch')[0] === t('provider-opt-switch-now', { model: target })) {
      await deps.switchModel(route, target)
    }
  }
  return 'added'
}
