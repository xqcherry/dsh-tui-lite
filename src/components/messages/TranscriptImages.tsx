import React from 'react'
import { Box, Text } from '../../ui.js'
import type { TranscriptImage } from '../../dsh-adapter/transcript-images.js'
import { cleanRenderText } from '../../dsh-adapter/sanitize.js'
import { t } from '../../i18n.js'

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
