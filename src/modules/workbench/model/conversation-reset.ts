import { t } from '../../../shared/i18n.js'
import type { SessionsSnapshot } from '../../sessions/contracts.js'
import type { ChatRow } from '../../../shared/protocol/transcript.js'

/** Backend reset clears the discarded conversation while retaining queued input. */
export function resetConversationProjection(
  ports: {
    readonly sessions: { readonly ingress: { setTitle(title: string): void; setCompaction(compaction: SessionsSnapshot['compaction']): void } }
    readonly transcript: { readonly ingress: { resetRows(): void; resetConversationState(): void; appendLocalRow(row: ChatRow): void } }
    readonly activity: { readonly ingress: { resetSessionCost(): void } }
  },
  rowIds: { value: number },
  trigger: string,
  effects: { resetProjector(): void; dropRows(): void; resetContextWarning(): void; publish(): void },
): void {
  ports.transcript.ingress.resetRows()
  rowIds.value = 0
  effects.resetProjector()
  effects.dropRows()
  ports.transcript.ingress.resetConversationState()
  ports.sessions.ingress.setTitle('')
  ports.activity.ingress.resetSessionCost()
  ports.sessions.ingress.setCompaction(undefined)
  effects.resetContextWarning()
  const key = trigger === 'clear' ? 'conversation-reset-clear'
    : trigger === 'plan_mode_exit' ? 'conversation-reset-plan'
      : trigger === 'fresh_session' ? 'conversation-reset-fresh'
        : 'conversation-reset'
  ports.transcript.ingress.appendLocalRow({ id: rowIds.value++, kind: 'notice', text: t(key) })
  effects.publish()
}
