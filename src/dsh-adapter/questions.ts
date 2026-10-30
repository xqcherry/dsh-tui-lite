import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import { QuestionStore as SharedQuestionStore } from '../channel/questions.js'

export type { QuestionDraft, QuestionSelection, QuestionSnapshot } from '../channel/questions.js'

/** Preserve the host protocol's cancellation error while sharing FIFO ownership. */
export class QuestionStore extends SharedQuestionStore {
  constructor() {
    super({ interruption: (message, code) => new UserQuestionError(message, code) })
  }
}
