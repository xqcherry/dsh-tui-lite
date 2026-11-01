import { t } from '../../../shared/i18n.js'
import type { Notify } from '../../../shared/protocol/notifications.js'
import { resolveModelRoute, type ModelRoute } from '../../settings/index.js'
import type { NewSessionOpener } from './session-switch.js'
import type { SessionReservation } from './session-transitions.js'

/** Backend resources are passed back unchanged; planning policy consumes data only. */
export interface NewSessionPlannerHost<Session, Id, Preset, Attempt = unknown> {
  readonly options: {
    readonly configuredPreset?: string
    readonly configuredProvider?: string
    readonly configuredModel?: string
    readonly provider: string
    readonly model: string
  }
  available(): boolean
  begin(): Attempt | undefined
  settleCompaction(): Promise<void>
  allocate(): Id
  readPresetPref(): string | undefined
  composePreset(preset: string | undefined): Promise<{ readonly resource: Preset; readonly agentPreset: string | undefined }>
  readModelPref(): ModelRoute | undefined
  validateRoute(route: ModelRoute, fallback: ModelRoute): Promise<{ readonly route: ModelRoute; readonly rejected?: ModelRoute }>
  migratePresetPref(previous: string | undefined, preset: string | undefined): boolean
  reserve(id: Id): Promise<SessionReservation>
  open(attempt: Attempt, id: Id, preset: Preset, route: ModelRoute, cwd: string): Promise<Session>
  attach(id: Id, cwd: string): Promise<void>
  reset(candidate: Session, agentPreset: string | undefined, route: ModelRoute): void
  bindAgent(): void
  refreshCommands(): void
  refreshLoadedContext(): Promise<void>
  refreshSkillCommands(): Promise<void>
  remember(candidate: Session): string
  notify: Notify
}

/** `/new` uses the existing guarded handoff; this supplies its client preparation and tail. */
export function createNewSessionPlanner<Session, Id, Preset, Attempt>(host: NewSessionPlannerHost<Session, Id, Preset, Attempt>): NewSessionOpener<Session> {
  const { options } = host
  return {
    dropsParkedInputs: true,
    available() {
      if (host.available()) return true
      host.notify(t('new-session-unavailable'), { color: 'error' })
      return false
    },
    async plan(target, current) {
      // Preserve the service lookup before compaction, separate from the entry gate.
      const attempt = host.begin()
      if (attempt === undefined) throw new Error(t('new-session-unavailable'))
      await host.settleCompaction()
      if (!current()) return undefined
      const id = host.allocate()
      const presetPref = options.configuredPreset === undefined ? host.readPresetPref() : undefined
      const composed = await host.composePreset(options.configuredPreset ?? presetPref)
      if (!current()) return undefined
      const fallback = { provider: options.provider, model: options.model }
      const resolved = resolveModelRoute(
        { provider: options.configuredProvider, model: options.configuredModel },
        host.readModelPref(),
        fallback,
      )
      const validated = await host.validateRoute(resolved, fallback)
      const route = validated.route
      if (!current()) return undefined
      if (!host.migratePresetPref(presetPref, composed.agentPreset)) {
        host.notify(t('preset-switched-pref-failed', { id: composed.agentPreset ?? presetPref ?? 'unknown' }), { color: 'warning' })
      }
      if (validated.rejected !== undefined) {
        host.notify(t('model-route-invalid', { provider: validated.rejected.provider, model: validated.rejected.model, fallback: `${route.provider}/${route.model}` }), { color: 'warning', timeoutMs: 8000 })
      }
      let reservation: SessionReservation | undefined
      return {
        async reserve() { reservation = await host.reserve(id) },
        open: cwd => host.open(attempt, id, composed.resource, route, cwd),
        async attach(_candidate, isCurrent) {
          try { await host.attach(id, target.cwd) }
          catch (error) {
            if (isCurrent()) host.notify(t('new-session-attach-failed', { err: error instanceof Error ? error.message : String(error) }), { color: 'warning', timeoutMs: 8000 })
          }
        },
        adopt(candidate) {
          host.reset(candidate, composed.agentPreset, route)
          host.bindAgent()
          host.refreshCommands()
          void host.refreshLoadedContext()
          void host.refreshSkillCommands()
          return host.remember(candidate)
        },
        finish(committed) {
          if (committed) reservation?.settle()
          else reservation?.abandon()
        },
      }
    },
  }
}
