import type { ClientSnapshot } from './client-state.js'
import type { ComposerActions } from './composer.js'
import type { ModelActions } from './models.js'
import type { ClientServices } from './services.js'
import type { SessionActions } from './sessions.js'

/** The in-process client consumed by the TUI. Domain contracts live alongside it. */
export interface Client extends ClientSnapshot, ComposerActions, SessionActions, ModelActions, ClientServices {}
