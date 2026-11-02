import type { SessionModeSpec } from './display.js'

/** Boot-only values. These do not provide access to another module's state. */
export interface ModuleLaunch {
  readonly options: {
    readonly model: string
    readonly provider: string
    readonly cwd: string
    readonly backendVersion?: string
    readonly effort?: string
    readonly configuredPreset?: string
    readonly configuredProvider?: string
    readonly configuredModel?: string
    readonly agentPreset?: string
  }
  readonly input: {
    readonly agentId: string
    readonly sessionId: string
    readonly mode: SessionModeSpec
    readonly cwdDescription: string
  }
}
