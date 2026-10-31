import React from 'react'
import { t } from '../../../shared/i18n.js'
import { Text } from '../../../ui/primitives.js'

/**
 * The dim "interrupted" row shown when the user stops a turn.
 */
export function TurnInterruptedRow(): React.ReactNode {
  return (
    <>
      <Text dimColor>{t('interrupted-by-user')}</Text>
      <Text dimColor>{t('interrupted-ask-next')}</Text>
    </>
  )
}
