import type { ComposerCommands } from '../../../modules/composer/contracts.js'
/**
 * Workspace files and slash completion for every session: the `fs` surface
 * `@` mentions and file completion read (the host fs service, else the local
 * disk where the backend runs on it), the fenced file queries, and the slash
 * completion tree with whatever catalog the composition offers for
 * `/model`, `/preset`, `/effort` and `/workspace` arguments. The backend's
 * own commands join the command list itself (core/session-controls.ts), so
 * completion lists them like any other entry.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandCompletionNode } from '../../../shared/commands.js'
import type { ChannelOwner } from '../../../shared/lifecycle/owner.js'
import type { ChannelBinding } from '../binding.js'
import { createCommandCompletions } from '../command-completions.js'
import { createFileActions } from '../file-actions.js'
import { mentionFs } from '../mentions.js'
import type { MentionFs } from '../types.js'

/** Argument catalogs the slash completion tree warms and reads. */
export interface CompletionCatalog {
  model: {
    warmModelNodes(): void
    modelNodes(): readonly CommandCompletionNode[]
    warmEffortLevels(): void
  }
}

/** No argument catalogs: the tree offers its static nodes only. */
export const NO_COMPLETION_CATALOG: CompletionCatalog = {
  model: {
    warmModelNodes: () => undefined,
    modelNodes: () => [],
    warmEffortLevels: () => undefined,
  },
}

export function createCoreFiles(ctx: Context, deps: {
  owner: Pick<ChannelOwner, 'current' | 'signal'>
  binding: Pick<ChannelBinding, 'capture' | 'isCurrent'>
  cwd(): string
  commands: Parameters<typeof createCommandCompletions>[0]['commands']
  settings: Parameters<typeof createCommandCompletions>[0]['settings']
  permissionPresets: Parameters<typeof createCommandCompletions>[0]['permissionPresets']
  /** Whether the local disk stands in for a missing host fs service. */
  /** The bound backend's MCP server names (`/mcp` completion). */
  mcpServers?(): readonly string[] | undefined
}) {
  // The session's working directory is the local disk when the host mounts
  // no fs service and the backend runs here (mentions and `@` completion).
  const fs = (): MentionFs | undefined => mentionFs(ctx)
  const fileActions = createFileActions({
    owner: deps.owner,
    capture: () => deps.binding.capture(),
    current: capture => deps.binding.isCurrent(capture as ReturnType<typeof deps.binding.capture>),
    cwd: deps.cwd,
    fs,
  })
  return {
    listFileCandidates: fileActions.listFileCandidates,
    listFiles: fileActions.listFiles,
    /** The slash completion over the composition's argument catalogs. */
    commandCompletions(catalog: CompletionCatalog): ComposerCommands['commandCompletions'] {
      return createCommandCompletions({
        commands: deps.commands,
        settings: deps.settings,
        permissionPresets: deps.permissionPresets,
        model: catalog.model,
      })
    },
  }
}
