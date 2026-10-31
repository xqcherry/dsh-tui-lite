import type { AgentEvent } from '../../../shared/protocol/events.js'

/** Parent tool-call identity for child-lane events; excluded from the main transcript. */
export function laneOf(event: AgentEvent): string | undefined {
  switch (event.type) {
    case 'assistant.attempt.start':
    case 'assistant.delta':
    case 'assistant.message':
    case 'tool.call':
    case 'tool.result':
    case 'tool.progress':
      return event.parentCallId
    default:
      return undefined
  }
}
