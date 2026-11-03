import React from 'react'
import type { WorkbenchModules } from '../contracts.js'
import { loadHistory } from '../../composer/index.js'
import type { PermissionPanelSource } from '../../decisions/contracts.js'
import type { QuestionStore } from '../../decisions/contracts.js'
import { createConfigurationCheck } from '../../settings/index.js'
import { createChatCommands, type ChatMenu, type ChatMenuItem } from '../model/chat-commands.js'
import { isPlainReturnInput } from '../../../shared/platform/modifiers.js'
import { ApprovalPanel } from '../../decisions/index.js'
import { HistorySearchDialog } from '../../composer/index.js'
import { MessageList } from '../../transcript/index.js'
import { PromptInput, type PromptController } from '../../composer/index.js'
import { AskUserQuestionPanel } from '../../decisions/index.js'
import { Box, ScrollBox, Text, useApp, useCopyOnSelect, useInput, type ScrollBoxHandle } from '../../../ui/primitives.js'
import { useHasSelection } from '../../../ink/hooks/use-selection.js'
import instances from '../../../ink/instances.js'
import { abbreviateHomePath } from '../../../shared/platform/paths.js'
import { t } from '../../../shared/i18n.js'
import { ProductHeader } from './ProductHeader.js'
import { ComposerStatusBar } from './ComposerStatusBar.js'
import { WorkingStatusLine } from './WorkingStatusLine.js'
import { CommandMenu } from './CommandMenu.js'
import { createHelpMenu } from '../model/help-menu.js'

export interface ChatProps {
  ports: WorkbenchModules
  questionStore: QuestionStore
  approvalStore: PermissionPanelSource
  modelConfigured?: () => Promise<boolean>
  initialPrompt?: string
  /**
   * Fixed-height alternate-screen layout: the transcript owns a scroll
   * viewport and the composer stays pinned to the terminal bottom.
   * Production mounts this through `<AlternateScreen>`; standalone tests and
   * embedders keep the inline layout.
   */
  fullscreen?: boolean
  onExit(): void
}

export function Chat({ ports, questionStore, approvalStore, modelConfigured, initialPrompt, fullscreen = false, onExit }: ChatProps): React.ReactNode {
  const { composer, sessions, settings, transcript, workbench } = ports
  const session = React.useSyncExternalStore(sessions.store.subscribe, sessions.store.getSnapshot)
  const displayCwd = abbreviateHomePath(session.displayCwd || session.cwd)
  const setting = React.useSyncExternalStore(settings.store.subscribe, settings.store.getSnapshot)
  const conversation = React.useSyncExternalStore(transcript.store.subscribe, transcript.store.getSnapshot)
  const workbenchState = React.useSyncExternalStore(workbench.store.subscribe, workbench.store.getSnapshot)
  const composerState = React.useSyncExternalStore(composer.store.subscribe, composer.store.getSnapshot)
  const question = React.useSyncExternalStore(listener => questionStore.subscribe(listener), () => questionStore.getSnapshot())
  const approval = React.useSyncExternalStore(listener => approvalStore.subscribe(listener), () => approvalStore.getSnapshot())
  const { stdout } = useApp()
  const [menu, setMenuState] = React.useState<ChatMenu | null>(null)
  const [focus, setFocusState] = React.useState(0)
  const [expanded, setExpanded] = React.useState(false)
  const [thinking, setThinking] = React.useState(true)
  const [expandedRows, setExpandedRows] = React.useState<ReadonlySet<number>>(new Set())
  const [historyQuery, setHistoryQueryState] = React.useState<string | null>(null)
  const [fillText, setFillText] = React.useState<string | null>(initialPrompt ?? null)
  const [configured, setConfigured] = React.useState(modelConfigured === undefined)
  const menuRef = React.useRef<ChatMenu | null>(null)
  const focusRef = React.useRef(0)
  const historyQueryRef = React.useRef<string | null>(null)
  const setMenu = (next: ChatMenu | null): void => { menuRef.current = next; setMenuState(next) }
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
  const [transcriptHandle, setTranscriptHandle] = React.useState<ScrollBoxHandle | null>(null)
  const hasSelection = useHasSelection()
  useCopyOnSelect(
    text => workbench.commands.notify(t('transcript-copied', { count: text.length }), { timeoutMs: 1500 }),
    () => workbench.commands.notify(t('transcript-copy-refused'), { color: 'warning' }),
  )
  const generation = session.agentBindingGeneration
  const rowCount = conversation.rows.length
  const firstRow = conversation.rows[0]
  const firstRowKey = firstRow ? `${firstRow.kind}:${firstRow.id}` : undefined
  const previousPage = React.useRef({ generation, rowCount, firstRowKey })
  React.useLayoutEffect(() => {
    const previous = previousPage.current
    // Inline rendering normally preserves the header's scrollback copy on
    // shrink. A session switch or clear starts a new page: its header must
    // be painted into the live viewport again, without erasing history.
    const cleared = previous.rowCount > 0 && rowCount <= 1 && (previous.rowCount > rowCount || previous.firstRowKey !== firstRowKey)
    if (previous.generation !== generation || cleared) {
      if (fullscreen) transcriptHandle?.scrollToBottom()
      else instances.get(stdout)?.reanchorViewport()
    }
    previousPage.current = { generation, rowCount, firstRowKey }
  }, [generation, rowCount, firstRowKey, stdout, fullscreen, transcriptHandle])
  const configurationCheck = React.useMemo(() => createConfigurationCheck({
    read: () => ({
      generation: sessions.store.getSnapshot().agentBindingGeneration,
      provider: settings.store.getSnapshot().provider,
      model: settings.store.getSnapshot().model,
    }),
    probe: modelConfigured,
    publish: setConfigured,
  }), [sessions, settings, modelConfigured])
  const refreshConfiguration = React.useCallback(() => configurationCheck.refresh(), [configurationCheck])
  React.useEffect(() => () => configurationCheck.dispose(), [configurationCheck])
  React.useEffect(() => { void refreshConfiguration() }, [refreshConfiguration, generation, setting.model, setting.provider])
  React.useEffect(() => { setExpandedRows(new Set()) }, [generation])
  const report = (error: unknown): void => {
    workbench.commands.notify(error instanceof Error ? error.message : String(error), { color: 'error' })
  }
  const perform = (operation: () => unknown | Promise<unknown>): void => {
    void Promise.resolve().then(operation).catch(report)
  }
  const openMenu = (title: string, items: readonly ChatMenuItem[]): void => {
    setFocus(0)
    setMenu({ title, items })
  }
  const openHelp = React.useMemo(() => createHelpMenu({
    readCommands: () => workbench.store.getSnapshot().commandList,
    openMenu,
    fillCommand: name => setFillText(`/${name} `),
  }), [workbench])
  const configuredRef = React.useRef(configured)
  configuredRef.current = configured
  const { runCommand } = React.useMemo(() => createChatCommands({
    ports,
    ask: (request, options) => questionStore.ask(request, options),
    openMenu,
    onExit,
    openHelp,
    toggleThinking: () => setThinking(value => !value),
    configured: () => configuredRef.current,
    refreshConfiguration,
  }), [ports, questionStore, onExit, refreshConfiguration, openHelp])
  const history = historyQuery === null ? [] : loadHistory(session.cwd).filter(entry => entry.text.toLowerCase().includes(historyQuery.toLowerCase()))
  const panelOpen = question !== null || approval !== null || menu !== null || historyQuery !== null
  const runningTool = React.useMemo(() => {
    if (!session.working || conversation.spinnerMode !== 'tool-use') return undefined
    for (let index = conversation.rows.length - 1; index >= 0; index--) {
      const row = conversation.rows[index]
      if (row?.kind !== 'tool' || row.tool?.status !== 'running') continue
      const title = row.tool.callView?.title?.replace(/\s+/g, ' ').trim()
      if (title) return title
      const name = row.tool.name.trim()
      return name === '' ? undefined : name[0]!.toUpperCase() + name.slice(1)
    }
    return undefined
  }, [conversation.rows, conversation.spinnerMode, session.working])

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
        if (item?.run) {
          setMenu(null)
          perform(item.run)
        }
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
    if (fullscreen && transcriptHandle !== null && (key.pageUp || key.pageDown)) {
      const step = Math.max(1, transcriptHandle.getViewportHeight() - 2)
      transcriptHandle.scrollBy(key.pageUp ? -step : step)
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
  const header = <ProductHeader
    key={`product-${generation}`}
    model={setting.model}
    provider={setting.provider}
    contextWindow={setting.contextWindow}
    cwd={displayCwd}
    backendVersion={workbenchState.backendVersion}
  />
  const transcriptList = <MessageList
    key={`transcript-${generation}`}
    rows={conversation.rows}
    expanded={expanded}
    expandedRows={expandedRows}
    selectedId={null}
    onToggleRow={id => setExpandedRows(previous => { const next = new Set(previous); if (!next.delete(id)) next.add(id); return next })}
    model={setting.model}
    olderHistory={conversation.olderHistory}
    onLoadOlder={() => perform(() => transcript.commands.loadOlder())}
    thinkingVisible={thinking}
    sessionCwd={session.cwd}
    scrollHandle={transcriptHandle}
    fullscreen={fullscreen}
  />
  // Bottom chrome never shrinks: the transcript viewport above it absorbs
  // every height change, so the composer stays at the terminal bottom.
  const bottomChrome = <Box flexDirection="column" flexShrink={0}>
    {!configured ? <Text color="warning">Configure a model with /provider, /auth or /model to get started.</Text> : null}
    {menu && !question && !approval ? <CommandMenu menu={menu} focus={focus} /> : null}
    {historyQuery !== null && !question && !approval ? <HistorySearchDialog query={historyQuery} cursorOffset={historyQuery.length} matches={history} focusIndex={focus} /> : null}
    {question && !approval ? <AskUserQuestionPanel
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
    {approval ? <ApprovalPanel key={approval.key} approval={approval} background={approval.agentId !== session.agentId} onDecide={(outcome, decision) => approvalStore.decide(outcome, decision)} /> : null}
    <WorkingStatusLine
      working={session.working && !panelOpen}
      spinnerMode={conversation.spinnerMode}
      turnStart={conversation.turnStart}
      activeToolCount={conversation.activeToolCount}
      toolName={runningTool}
    />
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
      suggestionsAbove={fullscreen}
      onOpenHelp={openHelp}
      onRunCommand={(name, raw, images) => runCommand(name, raw, images).catch(error => { report(error); return false })}
      selectionActive={hasSelection}
      fillText={fillText}
      onFillConsumed={() => setFillText(null)}
      controllerRef={controller}
      beforeSubmit={() => {
        if (configured) return true
        workbench.commands.notify('Configure a model first: /provider or /auth', { color: 'warning' })
        return false
      }}
    />
    <ComposerStatusBar model={setting.model} effort={setting.reasoningEffort} cwd={displayCwd} sessionTitle={session.sessionTitle} sessionColor={session.sessionColor} mode={session.mode} />
    <Box paddingLeft={1} height={1} flexShrink={0}>
      <Text dimColor wrap="truncate-end">? for shortcuts</Text>
    </Box>
  </Box>
  if (fullscreen) {
    return <Box flexDirection="column" height="100%" width="100%" flexShrink={0}>
      {header}
      <ScrollBox
        ref={setTranscriptHandle}
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        stickyScroll
      >
        {transcriptList}
      </ScrollBox>
      {bottomChrome}
    </Box>
  }
  return <Box flexDirection="column">
    {header}
    {transcriptList}
    {bottomChrome}
  </Box>
}
