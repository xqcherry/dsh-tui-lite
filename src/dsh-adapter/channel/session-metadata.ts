import { isValidSessionColor } from '../../shared/session-colors.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { isUserInvocable } from '@deepseek-ai/dsh-skill'
import type { ChannelOwner } from '../../shared/lifecycle/owner.js'
import { clearResumeTarget, forgetSession, readResumeTarget, touchSession, writeResumeTarget } from '../../modules/sessions/index.js'
import { appendSessionTitle, deleteSessionLog, userTitleData } from '../compat/index.js'
import { listSummaries, locateSession, previewSession, type SessionSource, type SessionSummary } from '../sessions/index.js'
import { readListingSnapshot } from '../sessions/snapshot.js'
import type { BindingCapture, ChannelBinding } from './binding.js'
import type { CredentialStatus } from './types.js'

const PREVIEW_ENTRIES = 8

type Capture = BindingCapture
type Binding = Pick<ChannelBinding, 'agent' | 'capture' | 'isCurrent'>

/** Session-scoped metadata, persistence queries, and tool-less LLM reads. */
export function createSessionMetadataActions(ctx: Context, deps: {
  owner: Pick<ChannelOwner, 'current' | 'signal'>
  binding: Binding
  provider(): string
  model(): string
  emit(): void
  sessionTitle(): string
  setSessionTitle(title: string): void
  skillRegistryFor(agent: Agent): { snapshot(options: { scope: Agent; cwd: string }): Promise<{ skills: readonly { name: string; description: string; source: string; invocation: unknown }[]; complete: boolean }> } | undefined
  skillViewOptions(agent: Agent): { scope: Agent; cwd: string }
}) {
  const current = (capture: Capture): boolean => deps.owner.current() && deps.binding.isCurrent(capture)
  const persistence = (): SessionSource | undefined => ctx.get('sessionPersistence') as SessionSource | undefined
  let listingGeneration = 0
  let lastListing: { source: SessionSource | symbol; rows: readonly SessionSummary[] } | undefined
  const remember = (source: SessionSource, rows: readonly SessionSummary[]): void => {
    lastListing = { source: source.identity ?? source, rows }
  }
  const cachedSessions = (): readonly SessionSummary[] | undefined => {
    const source = persistence()
    if (source === undefined) return undefined
    // Providers without a durable scope still keep same-instance reopen fast.
    // A replaced service never inherits this in-memory view.
    return lastListing?.source === (source.identity ?? source)
      ? lastListing.rows
      : readListingSnapshot(source)
  }
  const listSessions = async (onEnriched?: (summary: SessionSummary) => void, onPartial?: (rows: readonly SessionSummary[]) => void): Promise<readonly SessionSummary[]> => {
    const generation = ++listingGeneration
    const capture = deps.binding.capture()
    const source = persistence()
    if (!source) {
      return []
    }
    let summaries: readonly SessionSummary[] = []
    summaries = await listSummaries(source, deps.owner.signal, enriched => {
      if (!current(capture) || generation !== listingGeneration) return
      summaries = summaries.map(row => row.id === enriched.id ? enriched : row)
      remember(source, summaries)
      onEnriched?.(enriched)
    }, rows => {
      if (current(capture) && generation === listingGeneration) onPartial?.(rows)
    })
    if (!current(capture) || generation !== listingGeneration) return []
    remember(source, summaries)
    return summaries
  }

  const preview = async (sessionId: string) => {
    const capture = deps.binding.capture()
    const source = persistence()
    if (!source) return []
    const path = await locateSession(source, sessionId)
    if (!current(capture) || path === undefined) return []
    const entries = await previewSession(path, PREVIEW_ENTRIES)
    return current(capture) ? entries : []
  }

  const listSkills = async () => {
    const capture = deps.binding.capture()
    const target = capture.agent
    const registry = deps.skillRegistryFor(target)
    if (!registry) return []
    try {
      const observation = await registry.snapshot(deps.skillViewOptions(target))
      if (!current(capture) || !observation.complete) return undefined
      return observation.skills.map(skill => ({
        name: skill.name,
        description: skill.description,
        userInvocable: isUserInvocable(skill as Parameters<typeof isUserInvocable>[0]),
        source: skill.source,
      }))
    } catch {
      return current(capture) ? undefined : []
    }
  }

  const describeCredential = async (ref: string): Promise<CredentialStatus | undefined> => {
    const capture = deps.binding.capture()
    const credentials = ctx.get('credentials') as { describe(ref: string): Promise<CredentialStatus> } | undefined
    if (!credentials) return undefined
    try {
      const result = await credentials.describe(ref)
      return current(capture) ? result : undefined
    } catch (error) {      // `undefined` means the optional service is absent. Keep a live
      // credential service's read failure observable; only suppress it once
      // this Channel binding has been replaced or disposed.
      if (!current(capture)) return undefined
      throw error
    }
  }

  const renameSession = (title: string): void => {
    const capture = deps.binding.capture()
    if (!current(capture)) return
    // Live rename: the same strict-reader-required payload the offline append
    // writes — a `{ title }`-only event made the log unopenable (issue #1006).
    capture.agent.session.append('session/title', userTitleData(title))
    deps.setSessionTitle(title)
    deps.emit()
  }
  const setSessionColor = (color: string): void => {
    const capture = deps.binding.capture()
    if (!current(capture)) return
    if (color !== '' && !isValidSessionColor(color)) throw new Error(`Invalid session color: ${color}`)
    // The session event feed owns live projection, just as replay does.
    capture.agent.session.append('session/color', { color })
  }
  const deleteSession = async (sessionId: string): Promise<boolean> => {
    const capture = deps.binding.capture()
    if (sessionId === capture.agent.session.id || !current(capture)) return false
    if (deleteSessionLog(sessionId) !== 'deleted' || !current(capture)) return false
    forgetSession(sessionId)
    if (readResumeTarget() === sessionId) clearResumeTarget()
    return true
  }
  const renameSessionTo = async (sessionId: string, title: string): Promise<boolean> => {
    const capture = deps.binding.capture()
    if (!current(capture)) return false
    if (sessionId === capture.agent.session.id) { renameSession(title); return true }
    if (appendSessionTitle(sessionId, title) !== 'appended' || !current(capture)) return false
    touchSession(sessionId)
    return true
  }

  return {
    cachedSessions, listSessions, previewSession: preview, listSkills, describeCredential,
    setResumeTarget: writeResumeTarget,
    renameSession, setSessionColor, deleteSession, renameSessionTo,
  }
}
