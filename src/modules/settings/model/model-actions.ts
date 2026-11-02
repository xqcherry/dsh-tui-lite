import type { CommandCompletionNode } from '../../../shared/commands.js'
import type { EffortOption, LlmModelInfo, LlmProviderInfo } from '../../../shared/protocol/models.js'
import type { Notify } from '../../../shared/protocol/notifications.js'
import type { SettingsSnapshot } from '../contracts.js'
import { t, tOr, type I18nKey } from '../../../shared/i18n.js'
import { nearestLowerEffort, readEffortPref, resolveEffortDefault, STANDARD_EFFORT_LADDER, writeEffortPref } from './preferences/effortPrefs.js'

export interface SettingsModelInfo {
  context?: { contextWindow: number }
  reasoning?: boolean | { efforts?: readonly EffortOption[]; defaultEffort?: string }
}
export interface SettingsModelCatalog {
  resolveModelInfo(provider: string, model: string): Promise<SettingsModelInfo>
  listProviders(): readonly LlmProviderInfo[]
  listModels(provider: string): Promise<readonly LlmModelInfo[]>
}
export interface SettingsModelState {
  read(): Readonly<Pick<SettingsSnapshot, 'provider' | 'model' | 'reasoningEffort' | 'effortLevels'>>
  setReasoningEffort(value: string | undefined): void
  setEffortLevels(value: readonly string[] | undefined): void
  setContextWindow(value: number | undefined): void
}
export interface SettingsModelHost<Capture> {
  current(): boolean
  capture(): Capture
  bindingCurrent(capture: Capture): boolean
  models: SettingsModelCatalog | undefined
  pinnedEffort(): string | undefined
  pin(value: { provider: string; model: string; effort?: string }): void
  notify: Notify
  publish(): void
  checkContextWarning(): void
}

/** Model catalog, effort policy and request freshness belong to settings. */
export function createSettingsModelActions<Capture>(settings: SettingsModelState, host: SettingsModelHost<Capture>, initialEffort?: string) {
  const llmRuntime = host.models
  const { notify } = host
  let preferredEffort: string | undefined = initialEffort ?? readEffortPref()
  // Last fallback notice shown for a (preferred → applied) pair: bind fires on
  // every session switch, so an unchanged downgrade must not re-toast.
  let lastEffortFallbackNotice: { preferred: string; applied: string | undefined } | undefined
  // State construction cannot call this factory yet; seed the visible value
  // before the root starts binding or exposes the completed ChannelState.
  settings.setReasoningEffort(preferredEffort)
  let effortLevelsGeneration = 0
  let effortOperation = 0
  let preferredEffortUpdate: Promise<void> | undefined
  const effortWarm = { tried: false }
  const modelNodeCache = { nodes: undefined as readonly CommandCompletionNode[] | undefined, load: undefined as Promise<void> | undefined, generation: 0 }

  type EffortResult = { efforts: ReadonlyArray<{ id: string; name: string; description?: string }>; defaultEffort: string | undefined }
  type EffortCapture = { readonly binding: Capture; readonly provider: string; readonly model: string; readonly operation: number }
  const captureEffort = (): EffortCapture => ({
    binding: host.capture(), provider: settings.read().provider, model: settings.read().model, operation: ++effortOperation,
  })
  const effortCurrent = (capture: EffortCapture): boolean =>
    host.current() && host.bindingCurrent(capture.binding) &&
    settings.read().provider === capture.provider && settings.read().model === capture.model && effortOperation === capture.operation
  /** Route-level metadata shared by every resolveModelInfo consumer. The
   * context window follows the route, not the binding: a resume rebuilds
   * the binding (effortCurrent goes false) while the capacity answer for
   * the same provider/model is still the live truth, so this runs before
   * any effort freshness gate. Lifetime is the one fence it keeps: the
   * answer crosses an await, so a Channel released while the lookup was in
   * flight must neither write into its dead state nor re-arm the
   * context-low warning through checkContextWarning. */
  const applyRouteMetadata = (capture: EffortCapture, info: { context?: { contextWindow: number } }): void => {
    if (!host.current()) return
    if (settings.read().provider === capture.provider && settings.read().model === capture.model && info.context !== undefined) {
      settings.setContextWindow(info.context.contextWindow)
      host.checkContextWarning()
    }
  }
  /** Localized label of a standard ladder tier (the claude-effort-* family
   * is the repo's existing vocabulary for these five names). */
  const STANDARD_EFFORT_LABEL_KEYS: Record<string, I18nKey> = {
    low: 'claude-effort-low',
    medium: 'claude-effort-medium',
    high: 'claude-effort-high',
    xhigh: 'claude-effort-xhigh',
    max: 'claude-effort-max',
  }
  const standardEffortLabel = (id: string): string => {
    const key = STANDARD_EFFORT_LABEL_KEYS[id]
    return key === undefined ? id : tOr(key, id)
  }
  /** The standard ladder as picker options, resolved per call so a language
   * switch relabels tiers with no cache to invalidate. */
  const standardEffortOptions = (): Array<{ id: string; name: string }> =>
    STANDARD_EFFORT_LADDER.map(id => ({ id, name: standardEffortLabel(id) }))
  /** Effort tiers for one route-metadata answer. A row that declares
   * reasoning support without a tier list (`reasoning: true`, or an object
   * whose `efforts` is absent, as pi-ai zai rows for glm-5.3* do) gets the
   * standard ladder: the kernel accepts the standard ids and validates at
   * set time, and offering nothing would hide tiers the route does run.
   * An explicit `efforts: []` means the route supports none and is kept
   * as is, like any declared list; `reasoning` absent/false offers nothing. */
  const tiersOf = (reasoning: boolean | { efforts?: ReadonlyArray<{ id: string; name: string; description?: string }>; defaultEffort?: string } | undefined): ReadonlyArray<{ id: string; name: string; description?: string }> => {
    if (reasoning === true) return standardEffortOptions()
    if (reasoning === undefined || reasoning === false) return []
    if (reasoning.efforts !== undefined) return reasoning.efforts
    return standardEffortOptions()
  }
  const resolveEfforts = async (capture: EffortCapture): Promise<EffortResult | 'unavailable' | 'error' | 'stale'> => {
    if (llmRuntime === undefined || typeof llmRuntime.resolveModelInfo !== 'function') return 'unavailable'
    try {
      const info = await llmRuntime.resolveModelInfo(capture.provider, capture.model)
      applyRouteMetadata(capture, info)
      if (!effortCurrent(capture)) return 'stale'
      const efforts = tiersOf(info.reasoning)
      settings.setEffortLevels(efforts.map(level => level.id))
      return { efforts, defaultEffort: typeof info.reasoning === 'object' && info.reasoning !== null ? info.reasoning.defaultEffort : undefined }
    } catch (error) {
      if (!effortCurrent(capture)) return 'stale'
      notify(t('effort-read-failed', { error: error instanceof Error ? error.message : String(error) }), { color: 'error', timeoutMs: 8000 })
      return 'error'
    }
  }
  const applyPreferredEffortNow = async (): Promise<void> => {
    if (llmRuntime === undefined || typeof llmRuntime.resolveModelInfo !== 'function') return
    const capture = captureEffort()
    const resolved = await resolveEfforts(capture)
    if (resolved === 'unavailable' || resolved === 'error' || resolved === 'stale' || !effortCurrent(capture)) return
    // This same binding-time lookup is the route's initial tier refresh even
    // without a stored preference. Do not make a separate competing refresh
    // operation that could invalidate the selected preference completion.
    if (preferredEffort === undefined) return
    const available = resolved.efforts.map(effort => effort.id)
    // Exact hit applies silently; a miss falls back to the nearest LOWER tier
    // the route offers (never up), and both miss paths notify exactly once
    // per (preferred → applied) pair — bind fires on every session switch,
    // so an unchanged downgrade must not re-toast.
    const applied = nearestLowerEffort(preferredEffort, available)
    if (applied === undefined) {
      if (lastEffortFallbackNotice?.preferred !== preferredEffort || lastEffortFallbackNotice.applied !== undefined) {
        lastEffortFallbackNotice = { preferred: preferredEffort, applied: undefined }
        notify(t('effort-preference-unsupported', { preferred: preferredEffort }), { color: 'warning' })
      }
      // Nothing is pinned, so the ROUTE's model default is what actually ships
      // and the readout (status line, /effort status) must say so. Every switch
      // tail clears it before this runs (session-resume.ts / model-switch.ts /
      // session-live-adoption.ts / background-action.ts), but a resumed log's
      // replayed `request/header` can leave an older tier behind — neither blank
      // nor "last route's tier" is the truth. Only the readout moves: pinning
      // the default into selection.current would put a tier the user never chose
      // onto the wire, which is exactly what "never up" forbids.
      const shipped = resolved.defaultEffort
      if (settings.read().reasoningEffort !== shipped) {
        settings.setReasoningEffort(shipped)
        host.publish()
      }
      // An effort pin installed earlier (an exact hit, /effort <id>) survives
      // every path that is NOT a bind: /settings' effortDefault hands the level
      // straight to setDefaultEffort → applyPreferredEffort (plugin.ts:804 →
      // setDefaultEffort above), which never resets selection.current — the four
      // switch tails that do are all on the bind side. Leaving it would put the
      // OLD tier back on the wire while the readout above announces the model
      // default. Drop the effort only: the provider/model half of the pin is
      // this route's, not the stale tier's. No emit — setDefaultEffort reaches
      // here through that same non-bind path, and nothing UI-visible reads this
      // ref (it is the router's ModelSelectionRef, not the IDE ChannelSelection
      // the status line shows); the readout above already emits when it moves.
      if (host.pinnedEffort() !== undefined) {
        host.pin({ provider: capture.provider, model: capture.model })
      }
      return
    }
    // Dedupe gates ONLY the toast: bind resets selection.current on every
    // session switch, so the pin below must re-apply unconditionally — an
    // early return here would ship the model default from the second session
    // on (review C1). The status line shows the tier that actually ships.
    const fresh = lastEffortFallbackNotice?.preferred !== preferredEffort || lastEffortFallbackNotice.applied !== applied
    if (applied !== preferredEffort && fresh) {
      lastEffortFallbackNotice = { preferred: preferredEffort, applied }
      notify(t('effort-preference-downgraded', { preferred: preferredEffort, applied }), { color: 'warning' })
    }
    if (applied === preferredEffort) lastEffortFallbackNotice = undefined
    settings.setReasoningEffort(applied)
    host.pin({ provider: capture.provider, model: capture.model, effort: applied })
    host.publish()
  }
  const applyPreferredEffort = (): Promise<void> => {
    preferredEffortUpdate = applyPreferredEffortNow()
    return preferredEffortUpdate
  }
  const refreshEffortLevels = (): void => {
    if (llmRuntime === undefined || typeof llmRuntime.resolveModelInfo !== 'function') return
    const capture = captureEffort()
    const generation = ++effortLevelsGeneration
    void llmRuntime.resolveModelInfo(capture.provider, capture.model).then(info => {
      if (generation !== effortLevelsGeneration) return
      applyRouteMetadata(capture, info)
      if (!effortCurrent(capture)) return
      settings.setEffortLevels(tiersOf(info.reasoning).map(level => level.id))
      host.publish()
    }).catch(() => undefined)
  }
  const applyEffort = (effort: { id: string; name: string }, capture: EffortCapture): void => {
    if (!effortCurrent(capture)) return
    host.pin({ provider: capture.provider, model: capture.model, effort: effort.id })
    preferredEffort = effort.id
    settings.setReasoningEffort(effort.id)
    writeEffortPref(effort.id)
    notify(t('effort-switched', { name: effort.name }))
    host.publish()
  }
  const listEfforts = async (): Promise<{ efforts: readonly EffortOption[]; defaultEffort: string | undefined }> => {
    // Binding restores the saved preference asynchronously. Listing tiers must
    // let that finish before starting an operation that would invalidate it.
    await preferredEffortUpdate
    const capture = captureEffort()
    const resolved = await resolveEfforts(capture)
    if (resolved === 'stale') return { efforts: [], defaultEffort: undefined }
    if (resolved === 'unavailable') { notify(t('effort-unavailable'), { color: 'error' }); return { efforts: [], defaultEffort: undefined } }
    if (resolved === 'error') return { efforts: [], defaultEffort: undefined }
    if (!effortCurrent(capture)) return { efforts: [], defaultEffort: undefined }
    if (resolved.efforts.length === 0) notify(t('effort-unsupported'), { color: 'warning' })
    else if (resolved.efforts.length === 1) notify(t('effort-single-tier', { name: resolved.efforts[0]!.name }), { color: 'warning' })
    return resolved
  }
  const setEffort = async (id: string): Promise<boolean> => {
    const capture = captureEffort()
    const resolved = await resolveEfforts(capture)
    if (resolved === 'stale') return false
    if (resolved === 'unavailable') { notify(t('effort-unavailable'), { color: 'error' }); return false }
    if (resolved === 'error') return false
    if (!effortCurrent(capture)) return false
    if (resolved.efforts.length === 0) { notify(t('effort-unsupported'), { color: 'warning' }); return false }
    const found = resolved.efforts.find(effort => effort.id === id)
    if (found === undefined) { notify(t('effort-invalid', { id, ids: resolved.efforts.map(effort => effort.id).join(', ') }), { color: 'warning' }); return false }
    applyEffort(found, capture)
    return effortCurrent(capture)
  }
  /**
   * Re-seat the future-sessions default reasoning effort. `id` is the settings
   * user layer (the settings user layer outranks the cordis.yml `effort` pin);
   * an absent level re-derives the boot chain (cordis `effort` → the persisted
   * /effort choice). Also re-pins the live agent when its route offers the
   * level, so the change lands on the next request. No-op when unchanged.
   */
  const setDefaultEffort = (id: string | undefined): void => {
    const resolved = resolveEffortDefault(id, initialEffort, readEffortPref())
    if (resolved === preferredEffort) return
    preferredEffort = resolved
    void applyPreferredEffort()
  }
  const warmEffortLevels = (): void => {
    if (settings.read().effortLevels !== undefined || effortWarm.tried) return
    effortWarm.tried = true
    const capture = captureEffort()
    void resolveEfforts(capture).then(result => {
      if (result !== 'unavailable' && result !== 'error' && result !== 'stale' && effortCurrent(capture)) {
        effortWarm.tried = false
        host.publish()
      } else if (effortOperation === capture.operation) {
        // A stale route/binding has its own next bind warm; a transient
        // unavailable/error may be retried on a later explicit completion.
        effortWarm.tried = false
      }
    }).catch(() => undefined)
  }
  const listModels = (): Promise<readonly LlmModelInfo[]> => {
    if (llmRuntime === undefined) return Promise.resolve([])
    return Promise.all(llmRuntime.listProviders().map(provider => llmRuntime.listModels(provider.id).catch(() => []))).then(lists => lists.flat())
  }
  const listProviders = () => Promise.resolve(llmRuntime === undefined ? [] : llmRuntime.listProviders().map(info => ({ ...info })))
  const dropModelNodeCache = (): void => { modelNodeCache.generation += 1; modelNodeCache.nodes = undefined; modelNodeCache.load = undefined }
  const warmModelNodes = (): void => {
    if (modelNodeCache.load !== undefined) return
    const generation = modelNodeCache.generation
    modelNodeCache.load = listModels().then(list => {
      if (!host.current() || generation !== modelNodeCache.generation) return
      modelNodeCache.nodes = list.map(model => ({ name: `${model.provider}/${model.id}`, description: model.name, ...(settings.read().provider === model.provider && settings.read().model === model.id ? { tag: 'current' } : {}) }))
      host.publish()
    }).catch(() => { if (host.current() && generation === modelNodeCache.generation) modelNodeCache.nodes = [] })
  }
  return { applyPreferredEffort, refreshEffortLevels, listEfforts, setEffort, setDefaultEffort, warmEffortLevels, listModels, listProviders, dropModelNodeCache, warmModelNodes, modelNodes: () => modelNodeCache.nodes ?? [] }
}
