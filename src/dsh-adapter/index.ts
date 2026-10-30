import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-tui'
export const inject = ['agents']

export interface Config {
  sessionId?: string
  provider?: string
  model?: string
  cwd?: string
  effort?: string
  preset?: string
}

export const Config: Schema<Config> = Schema.object({
  sessionId: Schema.string(),
  provider: Schema.string(),
  model: Schema.string(),
  cwd: Schema.string(),
  effort: Schema.string(),
  preset: Schema.string(),
})

export async function apply(ctx: Context, config: Config): Promise<void> {
  const { apply: mount, handleStartupError } = await import('./plugin.js')
  let disposed = false
  ctx.effect(() => () => { disposed = true })
  const loader = ctx.get('loader') as { await(): Promise<unknown> } | undefined
  void (loader?.await() ?? ctx.fiber.await()).then(() => {
    if (!disposed) return ctx.plugin({ name: 'dsh-tui-runtime', apply: child => mount(child, config) })
  }).catch(error => {
    if (!disposed) handleStartupError(ctx, error)
  })
}
