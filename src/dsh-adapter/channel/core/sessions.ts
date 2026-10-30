/** Durable session listing, preview, metadata and resume actions. */
import type { SessionCatalog } from '../../../agent/backend.js'
import { formatSessionRef } from '../../../agent/refs.js'
import type { AgentSession } from '../../../agent/session.js'
import { t, type I18nKey } from '../../../i18n.js'
import { occupancyOf, readSessionOwners } from '../../../sessionMounts.js'
import type { ChannelActionDelegates } from '../action-readiness.js'
import type { ChannelOwner } from '../owner.js'
import type { ChannelLaunchOptions } from '../state.js'
import type { SessionSummary, TuiRewindMode } from '../../../adapter/ports/channel-session.js'
import type { ChannelState, ChatRow, ResumeResult } from '../types.js'

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)

export function createCoreSessionActions(deps: {
  owner: Pick<ChannelOwner, 'current'>
  session(): AgentSession
  state: () => ChannelState
  notify: ChannelState['notify']
  unavailable(name: string): void
  catalog: SessionCatalog | undefined
  prefs: ChannelLaunchOptions['sessionPrefs']
  /** The core `/resume` transaction (session-switch.ts). */
  resume(sessionId: string): Promise<ResumeResult>
  /** Whether `/resume` is offered (the backend's `open` and catalog). */
  canOpen: boolean
}) {
  const { notify, unavailable } = deps
  /** The last successful listing (the browser's first paint; may be stale). */
  let cached: readonly SessionSummary[] | undefined
  const rowOf = (sessionId: string): SessionSummary | undefined => cached?.find(row => row.id === sessionId)
  const isBound = (sessionId: string): boolean => deps.session().ref.sessionId === sessionId
  const failed = (key: I18nKey, error: unknown): void => {
    if (deps.owner.current()) notify(t(key, { err: errorText(error) }), { color: 'error', timeoutMs: 8000 })
  }

  const delegates: Partial<ChannelActionDelegates> = {
    cachedSessions: () => cached,

    /**
     * The bound backend's sessions: the working directory's first (painted
     * at once through `onPartial`), then every project the backend knows,
     * which the browser's rail groups by directory. A failing all-projects
     * read keeps the directory's rows.
     */
    async listSessions(_onEnriched, onPartial) {
      const catalog = deps.catalog
      if (catalog === undefined) { unavailable('resume'); return [] }
      const local = await catalog.list({ cwd: deps.state().cwd })
      onPartial?.(local)
      let all: readonly SessionSummary[]
      try {
        all = await catalog.list({ allProjects: true })
      } catch {
        all = local
      }
      const ids = new Set(all.map(row => row.id))
      const merged = [...all, ...local.filter(row => !ids.has(row.id))].sort((a, b) => b.updatedAt - a.updatedAt)
      cached = merged
      return merged
    },

    async previewSession(sessionId) {
      const preview = deps.catalog?.preview
      if (preview === undefined) { unavailable('resume'); return [] }
      try {
        const cwd = rowOf(sessionId)?.cwd
        return await preview(sessionId, { ...(cwd === undefined || cwd === '' ? {} : { cwd }) })
      } catch {
        return []
      }
    },

    async renameSessionTo(sessionId, title) {
      const rename = deps.catalog?.rename
      if (rename === undefined) { unavailable('rename'); return false }
      const next = title.trim()
      if (next === '') return false
      try {
        await rename(sessionId, next, rowOf(sessionId)?.cwd)
      } catch (error) {
        failed('rename-failed', error)
        return false
      }
      cached = cached?.map(row => row.id === sessionId ? { ...row, title: { text: next, source: 'renamed' } } : row)
      if (isBound(sessionId) && deps.owner.current()) {
        const state = deps.state()
        state.sessionTitle = next
        state.emit()
      }
      return true
    },

    /**
     * Delete a stored session: never the bound one, and never one another
     * TUI process has mounted (its transcript is being written). The MRU note
     * and the launcher marker go with it.
     */
    async deleteSession(sessionId) {
      const remove = deps.catalog?.delete
      if (remove === undefined) { unavailable('resume'); return false }
      if (isBound(sessionId)) return false
      const key = formatSessionRef({ backendId: deps.session().ref.backendId, sessionId })
      const occupancy = occupancyOf(key, readSessionOwners())
      if (occupancy.kind === 'occupied') {
        notify(t('resume-session-occupied', { pid: occupancy.pid }), { color: 'error', timeoutMs: 8000 })
        return false
      }
      try {
        await remove(sessionId, rowOf(sessionId)?.cwd)
      } catch (error) {
        failed('session-delete-failed', error)
        return false
      }
      deps.prefs?.forget(sessionId)
      cached = cached?.filter(row => row.id !== sessionId)
      return true
    },

    setResumeTarget(sessionId) {
      if (deps.prefs === undefined) { unavailable('resume'); return }
      deps.prefs.setLastSession(sessionId)
    },

    async resumeTo(sessionId) {
      if (!deps.canOpen) { unavailable('resume'); return { ok: false, reason: 'unavailable' } }
      const result = await deps.resume(sessionId)
      if (result.ok) deps.prefs?.setLastSession(sessionId)
      return result
    },

  }

  return { delegates }
}
