import type { ClientSnapshot } from './client-state.js'
import type { ComposerActions } from '../../modules/composer/contracts.js'
import type { ModelActions } from '../../modules/settings/contracts.js'
import type { ClientServices } from './services.js'
import type { SessionActions } from '../../modules/sessions/contracts.js'

/** The in-process client consumed by the TUI. Domain contracts live alongside it. */
export interface Client extends ClientSnapshot, ComposerActions, SessionActions, ModelActions, ClientServices {}
