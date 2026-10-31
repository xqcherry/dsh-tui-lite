import type { ProviderModelEditor, ProviderSetupHost } from '../../../../shared/protocol/provider-settings.js'
import type { LlmDiscoveredModel } from '../../../../shared/protocol/models.js'

import { isQuestionInterruption } from '../../../../shared/protocol/question-interruption.js'
import type { QuestionAnswer as AskUserQuestionAnswer, QuestionItem as AskUserQuestionItem, QuestionRequest as AskUserQuestionRequest } from '../../../decisions/contracts.js'


export const PROVIDER_ROUTE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export const PROVIDER_PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
] as const

export interface ProviderWizardDeps {
  readonly host: ProviderSetupHost
  readonly ask: (
    request: AskUserQuestionRequest,
    options?: { redact?: boolean },
  ) => Promise<AskUserQuestionAnswer>
  readonly notify: (
    text: string,
    options?: { color?: 'error' | 'warning' | 'success'; timeoutMs?: number },
  ) => void
  readonly pushLocal: (title: string, lines: readonly string[]) => void
  /** Live turn state; the model-switch question is skipped while working. */
  readonly working: () => boolean
  readonly switchModel: (provider: string, model: string) => Promise<boolean>
}

export type ProviderWizardOutcome = 'added' | 'updated' | 'deleted' | 'signed-out' | 'cancelled' | 'failed'

export const MAX_RETRY = 3

export type WizardQuestionItem = AskUserQuestionItem & {
  hideCustomInput?: boolean
  defaultSelected?: readonly string[]
  modelEditor?: ProviderModelEditor
}

export type RouteDiscoveryLive = 'fetched' | 'failed' | 'unavailable'

export type RouteDiscoveryCatalog = 'fetched' | 'failed' | 'unavailable'

export type RouteDiscoveryReason =
  | 'no-base-url'
  | 'unsupported-catalog'
  | 'custom-headers'

export interface RouteDiscovery {
  /** Merged rows: installed-catalog rows first (rich metadata), then
   *  endpoint-only ids in the order the endpoint advertised them. */
  readonly rows: readonly LlmDiscoveredModel[]
  /** Ids covered by the installed catalog (their rows carry catalog truth). */
  readonly catalogIds: ReadonlySet<string>
  /** Whether the installed catalog lookup was authoritative. */
  readonly catalog: RouteDiscoveryCatalog
  readonly live: RouteDiscoveryLive
  readonly reason?: RouteDiscoveryReason
}
