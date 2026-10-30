import React from 'react'
import type { ComposerImageRef } from '../adapter/ports/channel-view.js'
import type { ChannelUi } from '../adapter/ports/channel-ui.js'
import type { QuestionStore } from '../channel/questions.js'
import type { PermissionPanelSource } from '../channel/permissions.js'
import { MessageList } from '../components/MessageList.js'
import { PromptInput, type PromptController } from '../components/PromptInput.js'
import { AskUserQuestionPanel } from '../components/questions/AskUserQuestionPanel.js'
import { ApprovalPanel } from '../components/approvals/ApprovalPanel.js'
import { HistorySearchDialog } from '../components/HistorySearchDialog.js'
import { loadHistory } from '../history.js'
import { runProviderWizard, runOAuthLogin } from '../dsh-adapter/providerWizard.js'
import { Box, Text, useInput, useTerminalSize } from '../ui.js'
import { isPlainReturnInput } from '../utils/modifiers.js'

interface MenuItem { label: string; run(): void | Promise<unknown> }
interface Menu { title: string; items: readonly MenuItem[] }

export interface ChatProps {
  channel: ChannelUi
  questionStore: QuestionStore
  approvalStore: PermissionPanelSource
  modelConfigured?: () => Promise<boolean>
  initialPrompt?: string
  onExit(): void
  onRestart?(): void
  onUpdate?(): void
}

export function Chat({ channel, questionStore, approvalStore, modelConfigured, initialPrompt, onExit, onRestart, onUpdate }: ChatProps): React.ReactNode {
  React.useSyncExternalStore(listener => channel.subscribe(listener), () => channel.version)
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
  const generation = channel.agentBindingGeneration
  const refreshConfiguration = React.useCallback(async () => {
    if (!modelConfigured) return
    const current = channel.agentBindingGeneration
    const provider = channel.provider
    const model = channel.model
    const check = ++configurationCheck.current
    setConfigured(false)
    const stillCurrent = (): boolean => check === configurationCheck.current
      && current === channel.agentBindingGeneration
      && provider === channel.provider && model === channel.model
    try {
      const ready = await modelConfigured()
      if (stillCurrent()) setConfigured(ready)
    } catch {
      if (stillCurrent()) setConfigured(false)
    }
  }, [channel, modelConfigured])
  React.useEffect(() => { void refreshConfiguration() }, [refreshConfiguration, generation, channel.model, channel.provider])
  React.useEffect(() => { setExpandedRows(new Set()); setShowAll(false) }, [generation])
  const report = (error: unknown): void => {
    channel.notify(error instanceof Error ? error.message : String(error), { color: 'error' })
  }
  const perform = (operation: () => unknown | Promise<unknown>): void => {
    void Promise.resolve().then(operation).catch(report)
  }
  const openMenu = (title: string, items: readonly MenuItem[]): void => {
    setFocus(0)
    setMenu({ title, items })
  }
  const openModels = async (): Promise<void> => {
    const models = await channel.listModels()
    openMenu('Model', [
      { label: 'Configure a provider or API key', run: configureProvider },
      ...models.map(model => ({
        label: `${model.provider} / ${model.name || model.id}`,
        run: async () => { await channel.switchModel(model.provider, model.id); await refreshConfiguration() },
      })),
    ])
  }
  const configureProvider = async (): Promise<void> => {
    const host = channel.providerSetup()
    if (!host) { channel.notify('Provider configuration is unavailable in this host', { color: 'warning' }); return }
    if (loading.current) return
    loading.current = true
    try {
      await runProviderWizard({
        host,
        ask: (request, options) => questionStore.ask(request, options),
        notify: (text, options) => channel.notify(text, options),
        pushLocal: (title, lines) => channel.pushLocal(title, lines),
        working: () => channel.working,
        switchModel: (provider, model) => channel.switchModel(provider, model),
      })
      await refreshConfiguration()
    } finally { loading.current = false }
  }
  const openSessions = async (): Promise<void> => {
    const sessions = await channel.listSessions()
    openMenu('Resume session', sessions.filter(session => session.cwd === channel.cwd && session.id !== channel.agentId).map(session => ({
      label: typeof session.title === 'string' ? session.title : session.id,
      run: () => channel.resumeTo(session.id),
    })))
  }
  const runCommand = async (name: string, raw: string, images: readonly ComposerImageRef[]): Promise<boolean> => {
    const argument = raw.trim()
    switch (name) {
      case 'exit': onExit(); break
      case 'help': setHelp(value => !value); break
      case 'new': await channel.newSession(); break
      case 'resume':
      case 'session':
        if (argument && argument !== 'list') await channel.resumeTo(argument)
        else await openSessions()
        break
      case 'model':
        if (argument.includes('/')) {
          const separator = argument.indexOf('/')
          await channel.switchModel(argument.slice(0, separator), argument.slice(separator + 1))
          await refreshConfiguration()
        } else await openModels()
        break
      case 'provider': await configureProvider(); break
      case 'auth': {
        if (argument !== '' && argument !== 'login') {
          const outcome = await channel.runExternalCommandOutcome('auth', raw, images)
          if (outcome?.text) channel.notify(outcome.text, { color: outcome.kind === 'error' ? 'error' : undefined })
          await refreshConfiguration()
          return outcome?.consumeDraft === true
        }
        const oauth = channel.providerSetup()?.oauth
        if (!oauth) { channel.notify('Account login is unavailable in this host', { color: 'warning' }); break }
        const deps = {
          ask: (request: Parameters<QuestionStore['ask']>[0], options?: { redact?: boolean }) => questionStore.ask(request, options),
          notify: (text: string, options?: { color?: 'error' | 'warning' | 'success'; timeoutMs?: number }) => channel.notify(text, options),
          pushLocal: (title: string, lines: readonly string[]) => channel.pushLocal(title, lines),
        }
        openMenu('Account login', (await oauth.providers()).map(status => ({
          label: `${status.label}${status.signedIn ? ' (signed in)' : ''}`,
          run: async () => { await runOAuthLogin(deps, oauth, status.provider); await refreshConfiguration() },
        })))
        await refreshConfiguration()
        break
      }
      case 'effort': {
        if (argument) await channel.setEffort(argument)
        else openMenu('Reasoning effort', (await channel.listEfforts()).efforts.map(option => ({
          label: option.name, run: () => channel.setEffort(option.id),
        })))
        break
      }
      case 'permission': {
        if (argument) await channel.runPermissionPreset(argument)
        else openMenu('Permissions', channel.permissionPresets().options.map(option => ({
          label: `${option.name} — ${option.description}`, run: () => channel.runPermissionPreset(option.value),
        })))
        break
      }
      case 'rename': if (argument) await channel.renameSession(argument); else channel.notify('Usage: /rename <title>'); break
      case 'export': {
        const path = channel.exportSession()
        channel.notify(path ? `Exported: ${path}` : 'Session export failed', { color: path ? 'success' : 'error' })
        break
      }
      case 'compact': if (configured) await channel.compact(); else channel.notify('Configure a model first: /provider or /auth'); break
      case 'thinking': setThinking(value => !value); break
      case 'mcp': channel.pushLocal('MCP', channel.mcpStatus()); break
      case 'status': channel.pushLocal('Status', [channel.status, `${channel.provider}/${channel.model}`, channel.cwd]); break
      case 'doctor': channel.pushLocal('Diagnostics', await channel.doctorInfo()); break
      case 'restart': onRestart?.(); break
      case 'update': onUpdate?.(); break
      default: {
        const outcome = await channel.runExternalCommandOutcome(name, raw, images)
        if (outcome?.text) channel.notify(outcome.text, { color: outcome.kind === 'error' ? 'error' : undefined })
        return outcome?.consumeDraft === true
      }
    }
    return true
  }
  const history = historyQuery === null ? [] : loadHistory(channel.cwd).filter(entry => entry.text.toLowerCase().includes(historyQuery.toLowerCase()))
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
      const history = loadHistory(channel.cwd).filter(entry => entry.text.toLowerCase().includes(historyQuery.toLowerCase()))
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
    if (key.escape && channel.working) {
      if (!controller.current?.consumeEscape()) channel.cancel()
      return
    }
    if (key.ctrl && (input === 'c' || input === 'd')) {
      if (controller.current?.consumeSelectionCopy()) return
      if (channel.working) {
        if (channel.cancelPending) onExit()
        else channel.cancel()
      } else if (controller.current?.hasText()) controller.current.clear()
      else {
        if (Date.now() - lastExit.current < 1500) onExit()
        else { lastExit.current = Date.now(); channel.notify('Press Ctrl+C again to exit') }
      }
    }
  })
  const start = Math.max(0, focus - Math.max(2, Math.floor((terminalRows - 8) / 2)))
  return <Box flexDirection="column">
    <MessageList
      rows={channel.rows}
      expanded={expanded}
      expandedRows={expandedRows}
      selectedId={null}
      onToggleRow={id => setExpandedRows(previous => { const next = new Set(previous); if (!next.delete(id)) next.add(id); return next })}
      model={channel.model}
      showAll={showAll}
      onToggleAll={() => setShowAll(value => !value)}
      olderHistory={channel.olderHistory}
      onLoadOlder={() => perform(() => channel.loadOlder())}
      thinkingVisible={thinking}
    />
    <Text dimColor wrap="truncate-end">{[
      channel.working ? 'Working' : 'Ready',
      channel.model,
      channel.mode?.id,
      channel.contextOccupancy ? `ctx ${channel.contextOccupancy.usedTokens}/${channel.contextWindow ?? '?'}` : undefined,
      channel.displayCwd || channel.cwd,
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
      channel={channel}
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
        channel.notify('Configure a model first: /provider or /auth', { color: 'warning' })
        return false
      }}
    />
    {approval ? <ApprovalPanel key={approval.key} approval={approval} background={approval.agentId !== channel.agentId} onDecide={(outcome, decision) => approvalStore.decide(outcome, decision)} />
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
