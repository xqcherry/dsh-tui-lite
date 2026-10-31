import React from 'react'
import type { WorkbenchModules } from '../contracts.js'
import type { ComposerImageRef } from '../../../shared/protocol/composer.js'
import { loadHistory } from '../../composer/index.js'
import type { PermissionPanelSource } from '../../decisions/contracts.js'
import type { QuestionStore } from '../../decisions/contracts.js'
import { runOAuthLogin, runProviderWizard } from '../../settings/index.js'
import { isPlainReturnInput } from '../../../shared/platform/modifiers.js'
import { ApprovalPanel } from '../../decisions/index.js'
import { HistorySearchDialog } from '../../composer/index.js'
import { MessageList } from '../../transcript/index.js'
import { PromptInput, type PromptController } from '../../composer/index.js'
import { AskUserQuestionPanel } from '../../decisions/index.js'
import { Box, Text, useInput, useTerminalSize } from '../../../ui/primitives.js'

interface MenuItem { label: string; run(): void | Promise<unknown> }
interface Menu { title: string; items: readonly MenuItem[] }

export interface ChatProps {
  ports: WorkbenchModules
  questionStore: QuestionStore
  approvalStore: PermissionPanelSource
  modelConfigured?: () => Promise<boolean>
  initialPrompt?: string
  onExit(): void
}

export function Chat({ ports, questionStore, approvalStore, modelConfigured, initialPrompt, onExit }: ChatProps): React.ReactNode {
  const { composer, sessions, settings, transcript, workbench } = ports
  const session = React.useSyncExternalStore(sessions.store.subscribe, sessions.store.getSnapshot)
  const setting = React.useSyncExternalStore(settings.store.subscribe, settings.store.getSnapshot)
  const conversation = React.useSyncExternalStore(transcript.store.subscribe, transcript.store.getSnapshot)
  const composerState = React.useSyncExternalStore(composer.store.subscribe, composer.store.getSnapshot)
  const question = React.useSyncExternalStore(listener => questionStore.subscribe(listener), () => questionStore.getSnapshot())
  const approval = React.useSyncExternalStore(listener => approvalStore.subscribe(listener), () => approvalStore.getSnapshot())
  const { rows: terminalRows } = useTerminalSize()
  const [menu, setMenuState] = React.useState<Menu | null>(null)
  const [focus, setFocusState] = React.useState(0)
  const [help, setHelp] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const [thinking, setThinking] = React.useState(true)
  const [expandedRows, setExpandedRows] = React.useState<ReadonlySet<number>>(new Set())
  const [showAll, setShowAll] = React.useState(false)
  const [historyQuery, setHistoryQueryState] = React.useState<string | null>(null)
  const [fillText, setFillText] = React.useState<string | null>(initialPrompt ?? null)
  const [configured, setConfigured] = React.useState(modelConfigured === undefined)
  const menuRef = React.useRef<Menu | null>(null)
  const focusRef = React.useRef(0)
  const historyQueryRef = React.useRef<string | null>(null)
  const setMenu = (next: Menu | null): void => { menuRef.current = next; setMenuState(next) }
  const setFocus = (next: React.SetStateAction<number>): void => {
    focusRef.current = typeof next === 'function' ? next(focusRef.current) : next
    setFocusState(focusRef.current)
  }
  const setHistoryQuery = (next: React.SetStateAction<string | null>): void => {
    historyQueryRef.current = typeof next === 'function' ? next(historyQueryRef.current) : next
    setHistoryQueryState(historyQueryRef.current)
  }
  const controller = React.useRef<PromptController | null>(null)
  const lastExit = React.useRef(0)
  const loading = React.useRef(false)
  const configurationCheck = React.useRef(0)
  const generation = session.agentBindingGeneration
  const refreshConfiguration = React.useCallback(async () => {
    if (!modelConfigured) return
    const current = sessions.store.getSnapshot().agentBindingGeneration
    const provider = settings.store.getSnapshot().provider
    const model = settings.store.getSnapshot().model
    const check = ++configurationCheck.current
    setConfigured(false)
    const stillCurrent = (): boolean => check === configurationCheck.current
      && current === sessions.store.getSnapshot().agentBindingGeneration
      && provider === settings.store.getSnapshot().provider && model === settings.store.getSnapshot().model
    try {
      const ready = await modelConfigured()
      if (stillCurrent()) setConfigured(ready)
    } catch {
      if (stillCurrent()) setConfigured(false)
    }
  }, [sessions, settings, modelConfigured])
  React.useEffect(() => { void refreshConfiguration() }, [refreshConfiguration, generation, setting.model, setting.provider])
  React.useEffect(() => { setExpandedRows(new Set()); setShowAll(false) }, [generation])
  const report = (error: unknown): void => {
    workbench.commands.notify(error instanceof Error ? error.message : String(error), { color: 'error' })
  }
  const perform = (operation: () => unknown | Promise<unknown>): void => {
    void Promise.resolve().then(operation).catch(report)
  }
  const openMenu = (title: string, items: readonly MenuItem[]): void => {
    setFocus(0)
    setMenu({ title, items })
  }
  const openModels = async (): Promise<void> => {
    const models = await settings.commands.listModels()
    openMenu('Model', [
      { label: 'Configure a provider or API key', run: configureProvider },
      ...models.map(model => ({
        label: `${model.provider} / ${model.name || model.id}`,
        run: async () => { await settings.commands.switchModel(model.provider, model.id); await refreshConfiguration() },
      })),
    ])
  }
  const configureProvider = async (): Promise<void> => {
    const host = settings.commands.providerSetup()
    if (!host) { workbench.commands.notify('Provider configuration is unavailable in this host', { color: 'warning' }); return }
    if (loading.current) return
    loading.current = true
    try {
      await runProviderWizard({
        host,
        ask: (request, options) => questionStore.ask(request, options),
        notify: (text, options) => workbench.commands.notify(text, options),
        pushLocal: (title, lines) => transcript.commands.pushLocal(title, lines),
        working: () => sessions.store.getSnapshot().working,
        switchModel: (provider, model) => settings.commands.switchModel(provider, model),
      })
      await refreshConfiguration()
    } finally { loading.current = false }
  }
  const openSessions = async (): Promise<void> => {
    const savedSessions = await sessions.commands.listSessions()
    openMenu('Resume session', savedSessions.filter(saved => saved.cwd === sessions.store.getSnapshot().cwd && saved.id !== sessions.store.getSnapshot().agentId).map(session => ({
      label: typeof session.title === 'string' ? session.title : session.id,
      run: () => sessions.commands.resumeTo(session.id),
    })))
  }
  const runCommand = async (name: string, raw: string, images: readonly ComposerImageRef[]): Promise<boolean> => {
    const argument = raw.trim()
    switch (name) {
      case 'exit': onExit(); break
      case 'help': setHelp(value => !value); break
      case 'new': await sessions.commands.newSession(); break
      case 'resume':
      case 'session':
        if (argument && argument !== 'list') await sessions.commands.resumeTo(argument)
        else await openSessions()
        break
      case 'model':
        if (argument.includes('/')) {
          const separator = argument.indexOf('/')
          await settings.commands.switchModel(argument.slice(0, separator), argument.slice(separator + 1))
          await refreshConfiguration()
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
        const deps = {
          ask: (request: Parameters<QuestionStore['ask']>[0], options?: { redact?: boolean }) => questionStore.ask(request, options),
          notify: (text: string, options?: { color?: 'error' | 'warning' | 'success'; timeoutMs?: number }) => workbench.commands.notify(text, options),
          pushLocal: (title: string, lines: readonly string[]) => transcript.commands.pushLocal(title, lines),
        }
        openMenu('Account login', (await oauth.providers()).map(status => ({
          label: `${status.label}${status.signedIn ? ' (signed in)' : ''}`,
          run: async () => { await runOAuthLogin(deps, oauth, status.provider); await refreshConfiguration() },
        })))
        await refreshConfiguration()
        break
      }
      case 'effort': {
        if (argument) await settings.commands.setEffort(argument)
        else openMenu('Reasoning effort', (await settings.commands.listEfforts()).efforts.map(option => ({
          label: option.name, run: () => settings.commands.setEffort(option.id),
        })))
        break
      }
      case 'permission': {
        if (argument) await sessions.commands.runPermissionPreset(argument)
        else openMenu('Permissions', sessions.commands.permissionPresets().options.map(option => ({
          label: `${option.name} — ${option.description}`, run: () => sessions.commands.runPermissionPreset(option.value),
        })))
        break
      }
      case 'rename': if (argument) await sessions.commands.renameSession(argument); else workbench.commands.notify('Usage: /rename <title>'); break
      case 'export': {
        const path = transcript.commands.exportSession()
        workbench.commands.notify(path ? `Exported: ${path}` : 'Session export failed', { color: path ? 'success' : 'error' })
        break
      }
      case 'compact': if (configured) await transcript.commands.compact(); else workbench.commands.notify('Configure a model first: /provider or /auth'); break
      case 'thinking': setThinking(value => !value); break
      case 'mcp': transcript.commands.pushLocal('MCP', workbench.commands.mcpStatus()); break
      case 'status': transcript.commands.pushLocal('Status', [session.status, `${setting.provider}/${setting.model}`, session.cwd]); break
      case 'doctor': transcript.commands.pushLocal('Diagnostics', await workbench.commands.doctorInfo()); break
      default: {
        const outcome = await workbench.commands.runExternalCommandOutcome(name, raw, images)
        if (outcome?.text) workbench.commands.notify(outcome.text, { color: outcome.kind === 'error' ? 'error' : undefined })
        return outcome?.consumeDraft === true
      }
    }
    return true
  }
  const history = historyQuery === null ? [] : loadHistory(session.cwd).filter(entry => entry.text.toLowerCase().includes(historyQuery.toLowerCase()))
  const panelOpen = question !== null || approval !== null || menu !== null || historyQuery !== null

  useInput((input, key) => {
    if (question !== null || approval !== null) return
    const menu = menuRef.current
    const focus = focusRef.current
    const historyQuery = historyQueryRef.current
    if (menu !== null) {
      if (key.escape || (key.ctrl && input === 'c')) { setMenu(null); return }
      if (key.upArrow) setFocus(index => Math.max(0, index - 1))
      else if (key.downArrow) setFocus(index => Math.min(menu.items.length - 1, index + 1))
      else if (isPlainReturnInput(input, key)) {
        const item = menu.items[focus]
        setMenu(null)
        if (item) perform(item.run)
      }
      return
    }
    if (historyQuery !== null) {
      const history = loadHistory(session.cwd).filter(entry => entry.text.toLowerCase().includes(historyQuery.toLowerCase()))
      if (key.escape || (key.ctrl && input === 'c')) { setHistoryQuery(null); return }
      if (key.upArrow) setFocus(index => Math.max(0, index - 1))
      else if (key.downArrow || (key.ctrl && input === 'r')) setFocus(index => Math.min(history.length - 1, index + 1))
      else if (isPlainReturnInput(input, key)) {
        const entry = history[focus]
        if (entry) setFillText(entry.text)
        setHistoryQuery(null)
      } else if (key.backspace || key.delete) { setHistoryQuery(value => value?.slice(0, -1) ?? ''); setFocus(0) }
      else if (!key.ctrl && !key.meta && input) { setHistoryQuery(value => (value ?? '') + input); setFocus(0) }
      return
    }
    if (key.ctrl && input === 'r') { setHistoryQuery(''); setFocus(0); return }
    if (key.ctrl && input === 'o') { setExpanded(value => !value); return }
    if (key.escape && session.working) {
      if (!controller.current?.consumeEscape()) composer.commands.cancel()
      return
    }
    if (key.ctrl && (input === 'c' || input === 'd')) {
      if (controller.current?.consumeSelectionCopy()) return
      if (session.working) {
        if (composerState.cancelPending) onExit()
        else composer.commands.cancel()
      } else if (controller.current?.hasText()) controller.current.clear()
      else {
        if (Date.now() - lastExit.current < 1500) onExit()
        else { lastExit.current = Date.now(); workbench.commands.notify('Press Ctrl+C again to exit') }
      }
    }
  })
  const start = Math.max(0, focus - Math.max(2, Math.floor((terminalRows - 8) / 2)))
  return <Box flexDirection="column">
    <MessageList
      rows={conversation.rows}
      expanded={expanded}
      expandedRows={expandedRows}
      selectedId={null}
      onToggleRow={id => setExpandedRows(previous => { const next = new Set(previous); if (!next.delete(id)) next.add(id); return next })}
      model={setting.model}
      showAll={showAll}
      onToggleAll={() => setShowAll(value => !value)}
      olderHistory={conversation.olderHistory}
      onLoadOlder={() => perform(() => transcript.commands.loadOlder())}
      thinkingVisible={thinking}
    />
    <Text dimColor wrap="truncate-end">{[
      session.working ? 'Working' : 'Ready',
      setting.model,
      session.mode?.id,
      conversation.contextOccupancy ? `ctx ${conversation.contextOccupancy.usedTokens}/${setting.contextWindow ?? '?'}` : undefined,
      session.displayCwd || session.cwd,
    ].filter(Boolean).join(' · ')}</Text>
    {!configured ? <Text color="warning">Configure a model with /provider, /auth or /model to get started.</Text> : null}
    {menu && !question && !approval ? <Box flexDirection="column">
      <Text bold>{menu.title}</Text>
      {menu.items.slice(start, start + Math.max(3, terminalRows - 8)).map((item, index) => <Text key={start + index} inverse={start + index === focus}>{item.label}</Text>)}
      <Text dimColor>{menu.items.length ? '↑/↓ select · Enter confirm · Esc cancel' : 'No saved sessions'}</Text>
    </Box> : null}
    {historyQuery !== null && !question && !approval ? <HistorySearchDialog query={historyQuery} cursorOffset={historyQuery.length} matches={history} focusIndex={focus} /> : null}
    <PromptInput
      key={generation}
      composer={composer}
      context={{
        sessions: sessions.store,
        settings: settings.store,
        workbench: workbench.store,
        notify: workbench.commands.notify,
        cycleMode: sessions.commands.cycleMode,
      }}
      suspended={panelOpen}
      helpOpen={help}
      onToggleHelp={() => setHelp(value => !value)}
      onRunCommand={(name, raw, images) => runCommand(name, raw, images).catch(error => { report(error); return false })}
      selectionActive={false}
      fillText={fillText}
      onFillConsumed={() => setFillText(null)}
      controllerRef={controller}
      beforeSubmit={() => {
        if (configured) return true
        workbench.commands.notify('Configure a model first: /provider or /auth', { color: 'warning' })
        return false
      }}
    />
    {approval ? <ApprovalPanel key={approval.key} approval={approval} background={approval.agentId !== session.agentId} onDecide={(outcome, decision) => approvalStore.decide(outcome, decision)} />
      : question ? <AskUserQuestionPanel
        key={question.key}
        question={question.question}
        position={question.position}
        total={question.total}
        answered={question.answered}
        initialDraft={question.draft}
        onAnswer={selection => { if (questionStore.stillCurrent(question.key)) questionStore.answerCurrent(selection) }}
        onCancel={() => questionStore.cancelCurrent()}
        onEscape={draft => {
          const live = questionStore.getSnapshot()
          if (live?.canGoBack) {
            questionStore.backCurrent(questionStore.stillCurrent(question.key) ? draft : undefined)
          } else if (live && questionStore.stillCurrent(question.key)) {
            questionStore.cancelCurrent()
          }
        }}
        onBack={question.canGoBack ? draft => questionStore.backCurrent(draft) : undefined}
        onForward={question.canGoForward ? draft => questionStore.forwardCurrent(draft) : undefined}
      /> : null}
  </Box>
}
