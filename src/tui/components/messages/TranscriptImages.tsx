import React from 'react'
import type { TranscriptImage } from '../../../app/contracts/composer-view.js'
import { t } from '../../../app/i18n.js'
import { cleanRenderText } from '../../../app/transcript/sanitize.js'
import { Box, Text } from '../../primitives.js'

/** Image attachments remain readable in every terminal without decoding pixels. */
export function TranscriptImages({ images, indent = 2 }: {
  readonly images: readonly TranscriptImage[]
  readonly indent?: number
}): React.ReactNode {
  if (images.length === 0) return null
  return (
    <Box flexDirection="column" paddingLeft={indent}>
      {images.map((image, index) => (
        <Text key={`${image.id}:${index}`} dimColor>
          [{t('transcript-image')}: {cleanRenderText(image.name ?? '', 80) || image.id}]
        </Text>
      ))}
    </Box>
  )
}
