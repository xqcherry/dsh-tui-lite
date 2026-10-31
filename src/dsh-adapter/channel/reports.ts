import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { t } from '../../app/i18n.js'
import type { ChannelOwner } from '../../app/lifecycle/owner.js'
import { snapshotLiveSessionEvents } from '../compat/liveSession.js'
import { toolResultText } from './transcript.js'

/** Export only durable session facts. */
export function createReportActions(_ctx: Context, deps: {
  owner: Pick<ChannelOwner, 'current'>
  capture(): { readonly agent: Agent; readonly generation: number }
  current(capture: { readonly agent: Agent; readonly generation: number }): boolean
  cwd(): string
  model(): string
}) {
  const current = (capture: ReturnType<typeof deps.capture>): boolean => deps.owner.current() && deps.current(capture)
  const firstTextOf = (content: readonly unknown[] | undefined): string => {
    for (const block of content ?? []) {
      if (block === null || typeof block !== 'object') continue
      const record = block as { type?: unknown; text?: unknown }
      if (record.type === 'text' && typeof record.text === 'string') return record.text.trim()
    }
    return ''
  }
  const exportSession = (): string | null => {
    const capture = deps.capture()
    const agent = capture.agent
    const parts = [t('export-title'), '', t('export-time', { time: new Date().toLocaleString() }),
      t('export-model', { model: deps.model() }), t('export-session', { id: agent.id }), t('export-dir', { cwd: deps.cwd() }), '']
    for (const event of snapshotLiveSessionEvents(agent.session)) {
      switch (event.type) {
        case 'user/message': {
          if (event.data.source.kind !== 'user') break
          const text = firstTextOf(event.data.content)
          if (text) parts.push(`${t('export-user-section')}\n\n${text}\n`)
          break
        }
        case 'assistant/message':
          for (const block of event.data.message.content) {
            if (block.type === 'reasoning' && block.text) parts.push(`${t('export-thinking-section')}\n\n${block.text}\n`)
            else if (block.type === 'text' && block.text) parts.push(`${t('export-assistant-section')}\n\n${block.text}\n`)
          }
          break
        case 'tool/call': parts.push(`${t('export-tool-section', { name: event.data.name })}\n\n\`\`\`json\n${event.data.arguments}\n\`\`\`\n`); break
        case 'tool/result': {
          const text = toolResultText(event)
          if (text) parts.push(`${t('export-result-section')}\n\n\`\`\`\n${text}\n\`\`\`\n`)
          break
        }
      }
    }
    if (!current(capture)) return null
    try {
      const target = join(deps.cwd(), `dsh-tui-export-${Date.now()}.md`)
      writeFileSync(target, parts.join('\n'), 'utf8')
      return current(capture) ? target : null
    } catch { return null }
  }

  return { exportSession }
}
