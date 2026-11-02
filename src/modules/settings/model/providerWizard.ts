import { PROVIDER_ROUTE_ID } from './wizard/contracts.js'
import { PROVIDER_PROTOCOLS } from './wizard/contracts.js'
import { deriveKeyRef } from './wizard/profiles.js'
import type { ProviderWizardDeps } from './wizard/contracts.js'
import type { ProviderWizardOutcome } from './wizard/contracts.js'


import { answerSelected } from './wizard/questions.js'

import { optionQuestion } from './wizard/questions.js'

import { runAddFlow } from './wizard/add.js'
import { runEditWizard } from './wizard/edit.js'


import { runOAuthLogin } from './wizard/oauth.js'


import type { RouteDiscoveryLive } from './wizard/contracts.js'
import type { RouteDiscoveryCatalog } from './wizard/contracts.js'
import type { RouteDiscoveryReason } from './wizard/contracts.js'
import type { RouteDiscovery } from './wizard/contracts.js'


import type { ConfiguredProvider, OAuthProviderStatus, OAuthSetupHost, ProfilePathOp, ProviderSetupHost } from '../../../shared/protocol/provider-settings.js'
export type { CatalogProviderCandidate, ConfiguredProvider, OAuthLoginResult, OAuthProviderStatus, OAuthSetupHost, ProfilePathOp, ProviderSetupHost } from '../../../shared/protocol/provider-settings.js'
/**
 * `/provider` wizard — interactively adds, edits, or deletes an LLM
 * provider route at runtime.
 *
 * The wizard is a sequence of `QuestionStore` asks (the same panel the
 * model-facing `ask_user_question` tool uses), so it needs no UI state of
 * its own. All side effects go through {@link ProviderSetupHost}, which the
 * channel implements over the dsh settings/credentials/llm seams:
 *
 *   profile → settings `llm-pi-ai.providers.<route>` (dsh-llm-pi-ai watches
 *             the section and registers the route without a restart)
 *   key     → credentials store (`~/.dsh/.credentials.yaml`, 0600), named by
 *             the derived `<ROUTE>_API_KEY` env-style ref the profile's
 *             `apiKeyEnv` points at
 *
 * The module is React-free so `scripts/verify-provider-wizard.mjs` can drive
 * it headless with a stubbed host and scripted answers.
 */


import { t } from '../../../shared/i18n.js'
import { isQuestionInterruption } from '../../../shared/protocol/question-interruption.js'



/** Route id rule shared with the dsh configuration surface (web Models page). */


/** Wire protocols dsh-llm-pi-ai can serve on a manually declared route. */


/**
 * Derive the credential ref for a route, matching the official web UI
 * convention so TUI- and web-added providers resolve the same key.
 */


/** Max attempts for validated free-text prompts before giving up. */


/**
 * Local presentation extension carried through to AskUserQuestionPanel:
 * pure option questions hide the trailing free-text input row, and
 * `defaultSelected` pre-checks (multi-select) or default-focuses
 * (single-select) the listed option labels — e.g. the models already
 * enabled on a route being edited. Structurally assigned into the dsh
 * request type; the harness side never sets it, so model-facing asks keep
 * the input row and no pre-selection.
 */


/**
 * Run the provider wizard. Opens with an action choice (add / edit); the
 * add path runs the guided config flow, and edit picks a configured route
 * then opens a menu of targeted edits (API key, base URL, wire protocol,
 * model list, delete this provider) with the route locked. Each menu item
 * applies immediately and exits — no confirmation between picking an edit
 * and writing it — and patches only the picked field, leaving every other
 * stored setting (including fields the wizard does not model) in place.
 * For built-in (catalog) routes the menu is limited to API
 * key, model list, and delete; base URL and wire protocol are only
 * meaningful for custom endpoints. Resolves 'cancelled' when the user
 * dismisses any question (Esc) — nothing has been written at that point.
 */
export async function runProviderWizard(
  deps: ProviderWizardDeps,
): Promise<ProviderWizardOutcome> {
  const { ask, notify } = deps
  let action: 'add' | 'edit' = 'add'
  try {
    const actionAnswer = await ask({
      questions: [optionQuestion('action', '', [
        { label: t('provider-opt-action-add'), description: t('provider-opt-action-add-desc') },
        { label: t('provider-opt-action-edit'), description: t('provider-opt-action-edit-desc') },
      ], { hideCustomInput: true })],
    })
    const pickedAction = answerSelected(actionAnswer, 'action')[0]
    if (pickedAction === t('provider-opt-action-edit')) {
      action = 'edit'
      // `await` before returning keeps the sub-wizard's rejection inside the
      // try so its UserQuestionError maps to the action-specific outcome —
      // a bare `return promise` would bypass the catch below.
      return await runEditWizard(deps)
    }
    return await runAddFlow(deps)
  } catch (error) {
    if (isQuestionInterruption(error)) {
      notify(action === 'edit'
        ? t('provider-edit-cancelled')
        : t('provider-cancelled'))
      return 'cancelled'
    }
    const err = error instanceof Error ? error.message : String(error)
    notify(t('provider-write-failed', { err }), { color: 'error', timeoutMs: 8000 })
    return 'failed'
  }
}

/**
 * The guided add flow behind `/provider`'s "Add a new provider" branch:
 * mode (catalog / custom / optional OAuth), route, API key, endpoint /
 * protocol, model discovery + selection, confirm, then persist with
 * credential rollback. Esc anywhere cancels with nothing written.
 */


/**
 * The edit branch of `/provider`: pick a configured route, then open the
 * one-shot targeted-edit menu ({@link runEditMenu}) with the route locked.
 */


/**
 * The edit menu for one configured route: pick exactly one targeted edit and
 * apply it immediately. Base URL and wire protocol only make sense for
 * custom (non-catalog) routes, so built-in routes get a three-item menu —
 * API key / model list / delete.
 */


/** Menu rows for one edit session; base URL / protocol are custom-only.
 *  The catalog split reads the route's real catalog membership — an
 *  explicit `api` override on a built-in route does not make it custom. */


/** Replace the route's API key: prompt, then write the credential at once.
 *  An env-shadowed key cannot be edited from here; an empty answer is a
 *  no-op. The profile already points at the ref, so no profile write. */


/** Apply a targeted single-field edit as one path patch under the stored
 *  profile: the picked field is set, everything else — modeled or not —
 *  stays exactly as stored. No discovery rewrite: capacity refresh belongs
 *  to the model-list edit, not to a key/endpoint/protocol change. */


/** Edit the base URL (custom routes only): prompt the new endpoint, then
 *  patch just that field. An empty answer is a no-op. */


/** Edit the wire protocol (custom routes only): pick from the three wire
 *  protocols (the current one is default-focused), then patch just that
 *  field. Picking the current protocol is a no-op. */


/**
 * Re-discover the endpoint's models and pick the enabled set (the current
 * ones pre-checked), then patch just the profile's `models`. Kept models
 * reuse their stored entries unless explicitly edited with Tab. Other
 * per-model fields survive. Stored models stay editable during discovery
 * outages; a route with no rows falls back to manual ids. An empty enabled
 * set serves the whole catalog, or is rejected for custom routes.
 */


/** Whether two model lists are equal (undefined = the whole catalog = []). */


/**
 * Delete one configured route from inside the edit menu: confirm against a
 * summary, then unset the profile. The credential goes afterwards, as pure
 * best-effort cleanup — only when it is this route's own (not env-provided,
 * not shared with another profile). Unsetting the profile is the catalog
 * change: once it landed, every cleanup path still reports 'deleted' (with
 * an honest transcript line for what survived), so a failed key removal
 * never leaves the UI serving a stale model completion for a route that is
 * already gone. `failed` is reserved for the profile unset itself failing,
 * which really did change nothing.
 */


/** Short picker-row description for one configured provider. */


/** Confirm-summary lines for the delete branch (reuses the shared keyref
 *  and models lines; no credential values are ever rendered). */


/** Masked state line for one provider row in the OAuth pick question. */


/**
 * The sign-in flow of a backend session's `/login`: the `/provider` OAuth
 * branch preselected on one provider (sign in, or re-login / sign out when
 * already signed in). Same panels, same plugin flow.
 */


/**
 * The OAuth branch of `/provider`: pick a subscription provider, then sign
 * in (the plugin's own question panels carry the flow — device codes,
 * authorization URLs), or re-login / sign out when one is already signed in.
 * No settings or credential writes happen here; the plugin owns its store.
 * `preselect` skips the pick (a backend's own `/login`).
 */


/** Prompt for a route id until it validates or the retry budget runs out. */


/** Merge multi-select picks with comma/space-separated custom input, deduped. */


/** How the live endpoint probe of one discovery pass went. */


/** One route-model discovery pass, ready for the selection panel. */


/**
 * Discover the models of one route or draft in two passes.
 *
 * The upstream discovery seam answers a request that names a catalog
 * `provider` from the installed static catalog without touching the network.
 * A live probe therefore omits `provider`, but only when this adapter can
 * supply a stable protocol and the route has no custom headers (the upstream
 * seam cannot carry the named route's headers into an anonymous request).
 * The listings merge: an id present in both resolves to its catalog row,
 * endpoint-only ids append — those are the new models the wizard can surface.
 *
 * The `apiKey` field is omitted rather than sent empty when no key is
 * knowable: an empty string is a hard invalid-credential upstream, while an
 * absent field probes anonymously (a local gateway that needs no auth still
 * lists its models).
 */


/** Catalog routes whose protocol is stable enough for an un-named live probe. */


/** Compact capacity rendering for picker rows: 1000000 → 1M, 384000 → 384k. */


/**
 * Picker-row description for one discovered model. `isNew` tags an id the
 * installed catalog does not ship — it came from the live endpoint probe and
 * is the thing the user is most likely looking for.
 */


/** `Models: …` line with an optional (added · removed) delta suffix. */


/** Capacity fields for one discovered row, when the listing disclosed them. */


/** Catalog-covered ids inherit capabilities; endpoint-only ids adopt disclosed capacities. */


export { PROVIDER_ROUTE_ID } from './wizard/contracts.js'

export { PROVIDER_PROTOCOLS } from './wizard/contracts.js'

export { deriveKeyRef } from './wizard/profiles.js'

export type { ProviderWizardDeps } from './wizard/contracts.js'

export type { ProviderWizardOutcome } from './wizard/contracts.js'

export { runOAuthLogin } from './wizard/oauth.js'

export type { RouteDiscoveryLive } from './wizard/contracts.js'

export type { RouteDiscoveryCatalog } from './wizard/contracts.js'

export type { RouteDiscoveryReason } from './wizard/contracts.js'

export type { RouteDiscovery } from './wizard/contracts.js'
