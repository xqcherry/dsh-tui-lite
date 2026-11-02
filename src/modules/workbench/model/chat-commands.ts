import { SESSION_COLOR_NAMES, isValidSessionColor } from '../../../shared/session-colors.js'
import type { WorkbenchModules } from '../contracts.js'
import type { ComposerImageRef } from '../../../shared/protocol/composer.js'
import type { QuestionStore } from '../../decisions/contracts.js'
import { runOAuthLogin, runProviderWizard } from '../../settings/index.js'

export interface ChatMenuItem { label: string; run(): void | Promise<unknown> }
export interface ChatMenu { title: string; items: readonly ChatMenuItem[] }

export interface ChatCommandHost {
  ports: Pick<WorkbenchModules, 'sessions' | 'settings' | 'transcript' | 'workbench'>
  ask: QuestionStore['ask']
  openMenu(title: string, items: readonly ChatMenuItem[]): void
  onExit(): void
  toggleHelp(): void
  toggleThinking(): void
  configured(): boolean
  refreshConfiguration(): Promise<void>
}

/** Application command routing; menu state and keyboard handling stay in React. */
export function createChatCommands(deps: ChatCommandHost) {
  const { sessions, settings, transcript, workbench } = deps.ports
  const { openMenu, onExit, refreshConfiguration } = deps
  const showCommandResult = (title: string, lines: readonly string[]): void => {
    transcript.commands.pushLocal(title, lines, { commandResult: true })
  }
  let loading = false
  const switchModelAndChooseEffort = async (provider: string, model: string): Promise<void> => {
    const switched = await settings.commands.switchModel(provider, model)
    await refreshConfiguration()
    if (!switched) return
    const { efforts, defaultEffort } = await settings.commands.listEfforts()
    if (efforts.length <= 1) return
    const current = settings.store.getSnapshot().reasoningEffort ?? defaultEffort
    openMenu('/model · Reasoning effort', efforts.map(option => ({
      label: `${option.name}${option.id === current ? ' (current)' : ''}`,
      run: () => settings.commands.setEffort(option.id),
    })))
  }
  const openModels = async (): Promise<void> => {
    const models = await settings.commands.listModels()
    openMenu('/model', [
      { label: 'Configure a provider or API key', run: configureProvider },
      ...models.map(model => ({
        label: `${model.provider} / ${model.name || model.id}`,
        run: () => switchModelAndChooseEffort(model.provider, model.id),
      })),
    ])
  }
  const configureProvider = async (): Promise<void> => {
    const host = settings.commands.providerSetup()
    if (!host) { workbench.commands.notify('Provider configuration is unavailable in this host', { color: 'warning' }); return }
    if (loading) return
    loading = true
    try {
      await runProviderWizard({
        host,
        ask: (request, options) => deps.ask(request, options),
        notify: (text, options) => workbench.commands.notify(text, options),
        pushLocal: (title, lines) => transcript.commands.pushLocal(title, lines),
        working: () => sessions.store.getSnapshot().working,
        switchModel: (provider, model) => settings.commands.switchModel(provider, model),
      })
      await refreshConfiguration()
    } finally { loading = false }
  }
  const openSessions = async (): Promise<void> => {
    const savedSessions = await sessions.commands.listSessions()
    openMenu('/session', savedSessions.filter(saved => saved.cwd === sessions.store.getSnapshot().cwd && saved.id !== sessions.store.getSnapshot().agentId).map(session => ({
      label: session.title.text || session.id,
      run: () => sessions.commands.resumeTo(session.id),
    })))
  }
  const runCommand = async (name: string, raw: string, images: readonly ComposerImageRef[]): Promise<boolean> => {
    const argument = raw.trim()
    switch (name) {
      case 'exit': onExit(); break
      case 'help': deps.toggleHelp(); break
      case 'new': await sessions.commands.newSession(); break
      case 'resume':
      case 'session':
        if (argument && argument !== 'list') await sessions.commands.resumeTo(argument)
        else await openSessions()
        break
      case 'model':
        if (argument.includes('/')) {
          const separator = argument.indexOf('/')
          await switchModelAndChooseEffort(argument.slice(0, separator), argument.slice(separator + 1))
        } else await openModels()
        break
      case 'provider': await configureProvider(); break
      case 'auth': {
        if (argument !== '' && argument !== 'login') {
          const outcome = await workbench.commands.runExternalCommandOutcome('auth', raw, images)
          if (outcome?.text) workbench.commands.notify(outcome.text, { color: outcome.kind === 'error' ? 'error' : undefined })
          await refreshConfiguration()
          return outcome?.consumeDraft === true
        }
        const oauth = settings.commands.providerSetup()?.oauth
        if (!oauth) { workbench.commands.notify('Account login is unavailable in this host', { color: 'warning' }); break }
        const loginDeps = {
          ask: (request: Parameters<ChatCommandHost['ask']>[0], options?: { redact?: boolean }) => deps.ask(request, options),
          notify: (text: string, options?: { color?: 'error' | 'warning' | 'success'; timeoutMs?: number }) => workbench.commands.notify(text, options),
          pushLocal: (title: string, lines: readonly string[]) => transcript.commands.pushLocal(title, lines),
        }
        openMenu('/auth', (await oauth.providers()).map(status => ({
          label: `${status.label}${status.signedIn ? ' (signed in)' : ''}`,
          run: async () => { await runOAuthLogin(loginDeps, oauth, status.provider); await refreshConfiguration() },
        })))
        await refreshConfiguration()
        break
      }
      case 'effort': {
        if (argument) await settings.commands.setEffort(argument)
        else openMenu('/effort', (await settings.commands.listEfforts()).efforts.map(option => ({
          label: option.name, run: () => settings.commands.setEffort(option.id),
        })))
        break
      }
      case 'permission': {
        if (argument) await sessions.commands.runPermissionPreset(argument)
        else openMenu('/permission', sessions.commands.permissionPresets().options.map(option => ({
          label: `${option.name} — ${option.description}`, run: () => sessions.commands.runPermissionPreset(option.value),
        })))
        break
      }
      case 'color': {
        const color = argument.toLowerCase()
        if (!color) {
          const current = sessions.store.getSnapshot().sessionColor
          openMenu('/color', ['default', ...SESSION_COLOR_NAMES].map(name => ({
            label: `${name}${name === (isValidSessionColor(current) ? current : 'default') ? ' (current)' : ''}`,
            run: () => sessions.commands.setSessionColor(name === 'default' ? '' : name),
          })))
        } else if (color === 'default' || isValidSessionColor(color)) {
          sessions.commands.setSessionColor(color === 'default' ? '' : color)
        } else {
          workbench.commands.notify(`Usage: /color <default|${SESSION_COLOR_NAMES.join('|')}>`)
        }
        break
      }
      case 'rename': if (argument) await sessions.commands.renameSession(argument); else workbench.commands.notify('Usage: /rename <title>'); break
      case 'export': {
        const path = transcript.commands.exportSession()
        workbench.commands.notify(path ? `Exported: ${path}` : 'Session export failed', { color: path ? 'success' : 'error' })
        break
      }
      case 'compact': if (deps.configured()) await transcript.commands.compact(); else workbench.commands.notify('Configure a model first: /provider or /auth'); break
      case 'thinking': deps.toggleThinking(); break
      case 'mcp': showCommandResult('/mcp', workbench.commands.mcpStatus()); break
      case 'status': showCommandResult('/status', [sessions.store.getSnapshot().status, `${settings.store.getSnapshot().provider}/${settings.store.getSnapshot().model}`, sessions.store.getSnapshot().cwd]); break
      case 'doctor': showCommandResult('/doctor', await workbench.commands.doctorInfo()); break
      default: {
        const outcome = await workbench.commands.runExternalCommandOutcome(name, raw, images)
        if (outcome?.text) workbench.commands.notify(outcome.text, { color: outcome.kind === 'error' ? 'error' : undefined })
        return outcome?.consumeDraft === true
      }
    }
    return true
  }
  return { runCommand }
}
