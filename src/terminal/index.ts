/**
 * Public rendering surface, themed for dsh-tui.
 *
 * `Box` and `Text` are theme-aware wrappers around the local renderer, so
 * components can use `color="subtle"`-style semantic theme keys consistently.
 */
export { Ansi } from '../ink/Ansi.js'
export { default as Newline, type Props as NewlineProps } from '../ink/components/Newline.js'
export { NoSelect } from '../ink/components/NoSelect.js'
export {
  default as ScrollBox, type ScrollBoxHandle, type ScrollBoxProps
} from '../ink/components/ScrollBox.js'
export { default as Spacer } from '../ink/components/Spacer.js'
export type { Key } from '../ink/events/input-event.js'
export { useAnimationFrame } from '../ink/hooks/use-animation-frame.js'
export { default as useApp } from '../ink/hooks/use-app.js'
export { useCopyOnSelect } from '../ink/hooks/use-copy-on-select.js'
export { default as useInput } from '../ink/hooks/use-input.js'
export { default as useStdin } from '../ink/hooks/use-stdin.js'
export { useTerminalSize } from '../ink/hooks/use-terminal-size.js'
export { createRoot, default as render, renderSync } from '../ink/root.js'
export type { Instance, RenderOptions, Root } from '../ink/root.js'

export { default as Box } from '../ink/components/Box.js'
export { default as Text } from '../ink/components/Text.js'
