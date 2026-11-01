import type { MutableSnapshot } from '../../../shared/state/module-store.js'
import type { TranscriptSnapshot } from '../state-contracts.js'

export type ProjectionState = MutableSnapshot<TranscriptSnapshot>
