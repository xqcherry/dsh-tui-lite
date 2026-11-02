import React, { useContext, useInsertionEffect } from 'react'
import instances from '../instances.js'
import { DISABLE_MOUSE_TRACKING, ENABLE_MOUSE_TRACKING, ENTER_ALT_SCREEN, EXIT_ALT_SCREEN, HIDE_CURSOR } from '../termio/dec.js'
import { TerminalWriteContext } from '../useTerminalNotification.js'
import { isMouseClicksDisabled } from '../../shared/platform/fullscreen.js'
import useApp from '../hooks/use-app.js'
import Box from './Box.js'
import { TerminalSizeContext } from './TerminalSizeContext.js'

type Props = React.PropsWithChildren<{ mouseTracking?: boolean }>

/**
 * Own the alternate buffer for the lifetime of this subtree.
 *
 * The fixed-height root is what keeps the composer pinned to the terminal
 * bottom: the transcript gets a bounded viewport and the bottom chrome is a
 * separate, non-shrinking row group. Inline rendering derives its frame
 * height from the content, so any transcript growth or collapse moves the
 * prompt; the alternate screen removes that coupling.
 *
 * Enter/leave must happen before the first layout pass so the renderer never
 * paints a main-screen frame for this tree. The renderer itself is looked up
 * by stdout (same lookup the rest of the app uses); the single-instance
 * fallback covers custom stdout streams.
 */
export function AlternateScreen({ children, mouseTracking = true }: Props): React.ReactNode {
  const size = useContext(TerminalSizeContext)
  const write = useContext(TerminalWriteContext)
  const { stdout } = useApp()
  const mouse = mouseTracking && !isMouseClicksDisabled()
  useInsertionEffect(() => {
    if (write === null) return
    const renderer = instances.get(stdout) ??
      (instances.size === 1 ? instances.values().next().value : undefined)
    write(HIDE_CURSOR + ENTER_ALT_SCREEN + '\x1b[2J\x1b[H' + (mouse ? ENABLE_MOUSE_TRACKING : ''))
    renderer?.setAltScreenActive(true, mouse)
    return () => {
      renderer?.setAltScreenActive(false)
      renderer?.clearTextSelection()
      write((mouse ? DISABLE_MOUSE_TRACKING : '') + EXIT_ALT_SCREEN)
    }
  }, [write, mouse, stdout])
  return <Box flexDirection="column" height={size?.rows ?? 24} width="100%" flexShrink={0}>{children}</Box>
}
