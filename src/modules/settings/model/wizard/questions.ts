import type { ProviderModelEditor } from '../../../../shared/protocol/provider-settings.js'

import { t } from '../../../../shared/i18n.js'
import { isQuestionInterruption } from '../../../../shared/protocol/question-interruption.js'
import type { QuestionAnswer as AskUserQuestionAnswer, QuestionItem as AskUserQuestionItem } from '../../../decisions/contracts.js'


import { PROVIDER_ROUTE_ID } from './contracts.js'


import type { ProviderWizardDeps } from './contracts.js'

import { MAX_RETRY } from './contracts.js'
import type { WizardQuestionItem } from './contracts.js'


import type { RouteDiscovery } from './contracts.js'


export function answerText(answer: AskUserQuestionAnswer, id: string): string {
  return answer.answers.find(item => item.id === id)?.custom?.trim() ?? ''
}

export function answerSelected(answer: AskUserQuestionAnswer, id: string): readonly string[] {
  return answer.answers.find(item => item.id === id)?.selected ?? []
}

export function optionQuestion(
  id: string,
  question: string,
  options: readonly { label: string; description?: string }[],
  extra?: {
    detail?: string
    multiSelect?: boolean
    hideCustomInput?: boolean
    defaultSelected?: readonly string[]
    modelEditor?: ProviderModelEditor
  },
): AskUserQuestionItem {
  const item: WizardQuestionItem = {
    id,
    question,
    header: '/provider',
    options: options.map(option => ({ ...option })),
    ...(extra?.detail !== undefined ? { detail: extra.detail } : {}),
    ...(extra?.multiSelect ? { multiSelect: true } : {}),
    ...(extra?.hideCustomInput ? { hideCustomInput: true } : {}),
    ...(extra?.defaultSelected !== undefined ? { defaultSelected: extra.defaultSelected } : {}),
    ...(extra?.modelEditor !== undefined ? { modelEditor: extra.modelEditor } : {}),
  }
  return item
}

export function textQuestion(
  id: string,
  question: string,
  detail?: string,
  modelEditor?: ProviderModelEditor,
): AskUserQuestionItem {
  return {
    id,
    question,
    header: '/provider',
    ...(detail !== undefined ? { detail } : {}),
    ...(modelEditor !== undefined ? { modelEditor } : {}),
  }
}

export async function promptRouteId(
  ask: ProviderWizardDeps['ask'],
  notify: ProviderWizardDeps['notify'],
): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRY; attempt += 1) {
    const answer = await ask({
      questions: [textQuestion('route-id', t('provider-q-route-id'), t('provider-q-route-id-detail'))],
    })
    const route = answerText(answer, 'route-id')
    if (PROVIDER_ROUTE_ID.test(route)) return route
    notify(t('provider-route-id-invalid'), { color: 'warning' })
  }
  return ''
}

export function mergeModelIds(selected: readonly string[], custom: string): string[] {
  const ids = [...selected]
  for (const piece of custom.split(/[,，\s]+/)) {
    const id = piece.trim()
    if (id !== '' && !ids.includes(id)) ids.push(id)
  }
  return ids
}

export function modelCustomInput(
  answer: AskUserQuestionAnswer,
  isCatalog: boolean,
  discovery: RouteDiscovery,
  notify: ProviderWizardDeps['notify'],
): string {
  const custom = answerText(answer, 'models')
  if (custom !== '' && isCatalog && discovery.reason === 'unsupported-catalog') {
    notify(t('provider-catalog-models-only'), { color: 'warning' })
    return ''
  }
  return custom
}
