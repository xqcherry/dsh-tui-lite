import { isEnvTruthy } from './envUtils.js'

/**
 * Whether mouse click handling is disabled. dsh-tui reads its own environment
 * flag (`DSH_TUI_DISABLE_MOUSE`) for this decision.
 * @returns True when DSH_TUI_DISABLE_MOUSE is set to a truthy value.
 */
export function isMouseClicksDisabled(): boolean {
  return isEnvTruthy(process.env.DSH_TUI_DISABLE_MOUSE)
}

/**
 * Whether the app mounts in the alternate screen with a fixed-height layout.
 *
 * Fullscreen is the default: the transcript gets its own scroll viewport and
 * the composer is pinned to the terminal bottom, independent of transcript
 * growth. `DSH_TUI_INLINE=1` is the escape hatch for terminals (or nested
 * hosts) where the alternate screen is unavailable, and preserves the
 * previous inline behaviour.
 */
export function isFullscreenEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isEnvTruthy(env.DSH_TUI_INLINE)
}
