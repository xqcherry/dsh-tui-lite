import type { SessionsSnapshot } from '../../../modules/sessions/contracts.js'
import type { SettingsSnapshot } from '../../../modules/settings/contracts.js'
/**
 * Reports every session gets: `/doctor` (the backend-neutral facts plus the
 * backend's own diagnostics lines) and `/export` (the projected transcript as
 * Markdown in the working directory). A composition with a richer source
 * overrides them; the DSH extension exports the durable session log.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { t } from '../../../shared/i18n.js'
import type { ChannelOwner } from '../../../shared/lifecycle/owner.js'
import type { DshSession as AgentSession } from '../../backend/session.js'
import type { ChannelBinding } from '../binding.js'
import type { ChatRow } from '../types.js'

/** One transcript row as an export section; undefined = not exported. */
function exportSection(row: ChatRow): string | undefined {
  switch (row.kind) {
    case 'user':
      return row.text === '' ? undefined : `${t('export-user-section')}\n\n${row.text}\n`
    case 'reasoning':
      return row.text === '' ? undefined : `${t('export-thinking-section')}\n\n${row.text}\n`
    case 'assistant':
      return row.text === '' ? undefined : `${t('export-assistant-section')}\n\n${row.text}\n`
    case 'tool': {
      const tool = row.tool
      if (tool === undefined) return undefined
      const parts = [`${t('export-tool-section', { name: tool.name })}\n\n\`\`\`json\n${tool.argsFull ?? tool.argsText}\n\`\`\`\n`]
      const result = tool.resultFull ?? tool.resultText ?? tool.errorText
      if (result !== undefined && result !== '') parts.push(`${t('export-result-section')}\n\n\`\`\`\n${result}\n\`\`\`\n`)
      return parts.join('\n')
    }
    default:
      return undefined
  }
}

export function createCoreReports(deps: {
  owner: Pick<ChannelOwner, 'current'>
  binding: Pick<ChannelBinding, 'session' | 'capture' | 'isCurrent'>
  session(): Readonly<Pick<SessionsSnapshot, 'cwd' | 'agentId'>>
  settings(): Readonly<Pick<SettingsSnapshot, 'model' | 'contextWindow'>>
  rows(): readonly ChatRow[]
}) {
  /** `/doctor`: the backend-neutral facts plus the backend's own lines. */
  const doctorInfo = (): string[] => {
    const session: AgentSession = deps.binding.session
    const label = 'DSH'
    return [
      `Node ${process.version} · ${process.platform} ${process.arch}`,
      t('doctor-backend', { label, id: 'dsh' }),
      t('doctor-model', { model: deps.settings().model || t('doctor-unknown'), provider: label }),
      t('doctor-cwd', { cwd: deps.session().cwd }),
      t('doctor-context-window', { window: deps.settings().contextWindow ?? t('doctor-unknown') }),
      t('doctor-session', { id: session.sessionId }),
    ]
  }

  /**
   * `/export`: the transcript as this channel projected it (user, thinking,
   * assistant and tool rows), written next to the session's work. Returns
   * the file path, or null when the binding moved on or the write failed.
   */
  const exportSession = (): string | null => {
    const capture = deps.binding.capture()
    const current = (): boolean => deps.owner.current() && deps.binding.isCurrent(capture)
    const parts = [t('export-title'), '', t('export-time', { time: new Date().toLocaleString() }),
      t('export-model', { model: deps.settings().model }), t('export-session', { id: deps.session().agentId }), t('export-dir', { cwd: deps.session().cwd }), '']
    for (const row of deps.rows()) {
      const section = exportSection(row)
      if (section !== undefined) parts.push(section)
    }
    if (!current()) return null
    try {
      const target = join(deps.session().cwd, `dsh-tui-export-${Date.now()}.md`)
      writeFileSync(target, parts.join('\n'), 'utf8')
      return current() ? target : null
    } catch {
      return null
    }
  }

  return { doctorInfo, exportSession }
}
