import React from 'react'
import { Box } from '../../../ui/primitives.js'
import { Markdown } from '../../../ui/Markdown.js'
import { StreamingMarkdown } from '../../../ui/StreamingMarkdown.js'

type Props = {
  text: string
  /** Adds the top margin between turns. */
  marginTopOnTurn: boolean
  /** True while the provider is still delivering chunks. */
  streaming?: boolean
  isSelected?: boolean
}

/**
 * Assistant text: markdown with the OpenCode-style three-column transcript
 * indent. The old `●` bullet is gone — activity is carried by the tool rows
 * and the working line, not by a marker on every answer.
 */
export function AssistantTextMessage({
  text,
  marginTopOnTurn,
  streaming = false,
  isSelected = false,
}: Props): React.ReactNode {
  if (text === '') return null
  return (
    <Box
      flexDirection="column"
      marginTop={marginTopOnTurn ? 1 : 0}
      paddingLeft={3}
      width="100%"
      backgroundColor={isSelected ? 'messageActionsBackground' : undefined}
    >
      {streaming
        ? <StreamingMarkdown>{text}</StreamingMarkdown>
        : <Markdown>{text}</Markdown>}
    </Box>
  )
}
