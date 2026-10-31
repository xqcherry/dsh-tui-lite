/** Why an ask rejected: the user dismissed it, or it was interrupted. */
export type QuestionInterruption = 'ASK_CANCELLED' | 'ASK_ABORTED'

/** The default interruption error (a host may inject its protocol's own). */
export class QuestionInterruptedError extends Error {
  readonly code: QuestionInterruption
  constructor(message: string, code: QuestionInterruption) {
    super(message)
    this.name = 'QuestionInterruptedError'
    this.code = code
  }
}

/** Whether `error` is an ask rejected by the user or by an abort (either
 *  store's interruption error carries the code). */
export function isQuestionInterruption(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  return code === 'ASK_CANCELLED' || code === 'ASK_ABORTED'
}
