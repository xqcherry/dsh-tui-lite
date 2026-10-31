import type { OAuthSetupHost } from '../../../../shared/protocol/provider-settings.js'

import { t } from '../../../../shared/i18n.js'
import { isQuestionInterruption } from '../../../../shared/protocol/question-interruption.js'



import type { ProviderWizardDeps } from './contracts.js'
import type { ProviderWizardOutcome } from './contracts.js'


import { answerSelected } from './questions.js'

import { optionQuestion } from './questions.js'


import { oauthStateDescription } from './profiles.js'


export function runOAuthLogin(
  deps: Pick<ProviderWizardDeps, 'ask' | 'notify' | 'pushLocal'>,
  oauth: OAuthSetupHost,
  provider: string,
): Promise<ProviderWizardOutcome> {
  return runOAuthWizard(deps, oauth, provider)
}

export async function runOAuthWizard(
  deps: Pick<ProviderWizardDeps, 'ask' | 'notify' | 'pushLocal'>,
  oauth: OAuthSetupHost,
  preselect?: string,
): Promise<ProviderWizardOutcome> {
  const { ask, notify, pushLocal } = deps
  try {
    const statuses = await oauth.providers()
    if (statuses.length === 0) {
      notify(t('provider-oauth-none'), { color: 'warning' })
      return 'failed'
    }
    let status: (typeof statuses)[number] | undefined
    if (preselect !== undefined) {
      status = statuses.find(row => row.provider === preselect)
      if (status === undefined) {
        notify(t('provider-oauth-unmounted', { provider: preselect }), { color: 'warning', timeoutMs: 8000 })
        return 'failed'
      }
    } else {
      const pickAnswer = await ask({
        questions: [optionQuestion('oauth-provider', t('provider-q-oauth'), statuses.map(row => ({
          label: row.provider,
          description: oauthStateDescription(row),
        })), { hideCustomInput: true })],
      })
      const providerId = answerSelected(pickAnswer, 'oauth-provider')[0]
      status = statuses.find(row => row.provider === providerId)
    }
    if (status === undefined) return 'cancelled'

    if (status.signedIn) {
      const actionAnswer = await ask({
        questions: [optionQuestion('oauth-signed-action', t('provider-q-oauth-signed', { provider: status.provider }), [
          { label: t('provider-opt-oauth-relogin'), description: t('provider-opt-oauth-relogin-desc') },
          { label: t('provider-opt-oauth-logout'), description: t('provider-opt-oauth-logout-desc') },
          { label: t('provider-opt-confirm-cancel') },
        ], { hideCustomInput: true })],
      })
      const action = answerSelected(actionAnswer, 'oauth-signed-action')[0]
      if (action === t('provider-opt-oauth-logout')) {
        await oauth.logout(status.provider)
        pushLocal('/provider', [
          t('provider-line-oauth-provider', { provider: status.provider }),
          t('provider-line-oauth-out'),
        ])
        notify(t('provider-oauth-logout-ok', { provider: status.provider }), { color: 'success' })
        return 'signed-out'
      }
      if (action !== t('provider-opt-oauth-relogin')) return 'cancelled'
    }

    const result = await oauth.login(status.provider)
    pushLocal('/provider', [
      t('provider-line-oauth-provider', { provider: result.provider }),
      t('provider-line-oauth-flow', { flow: result.oauthLabel }),
      ...(result.expiresAt === undefined
        ? []
        : [t('provider-line-oauth-expires', { time: new Date(result.expiresAt).toISOString() })]),
      t('provider-switch-hint'),
    ])
    notify(t('provider-oauth-login-ok', { provider: result.provider }), { color: 'success' })
    return 'added'
  } catch (error) {
    if (isQuestionInterruption(error)) {
      notify(t('provider-cancelled'))
      return 'cancelled'
    }
    const err = error instanceof Error ? error.message : String(error)
    notify(t('provider-oauth-login-failed', { err }), { color: 'error', timeoutMs: 8000 })
    return 'failed'
  }
}
