import React from 'react'
import type { TranscriptImage } from '../../../shared/protocol/composer.js'
import { t } from '../../../shared/i18n.js'
import { cleanRenderText } from '../../../shared/platform/render-text.js'
import { Box, Text } from '../../../ui/primitives.js'

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
