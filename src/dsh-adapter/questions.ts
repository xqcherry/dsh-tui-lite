import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import { QuestionStore as SharedQuestionStore } from '../modules/decisions/index.js'

export type { QuestionDraft, QuestionSelection, QuestionSnapshot } from '../modules/decisions/contracts.js'

/** Preserve the host protocol's cancellation error while sharing FIFO ownership. */
export class QuestionStore extends SharedQuestionStore {
  constructor() {
    super({ interruption: (message, code) => new UserQuestionError(message, code) })
  }
}
