import type { ClientState } from './client-state.js'

export interface ClientLaunchOptions {
  model: string
  cwd: string
  provider: string
  effort?: string
  configuredPreset?: string
  configuredProvider?: string
  configuredModel?: string
  agentPreset?: string
}

/**
 * Neutral observable fields only. Behaviour is assembled explicitly by the
 * composition root after each specialist owner exists, so this factory cannot
 * acquire services, subscribe, or create a second authority bag.
 */
export function createInitialChannelView(
  options: ClientLaunchOptions,
  input: { agentId: string; sessionId: string; mode: ClientState['mode']; cwdDescription: string },
): Pick<ClientState,
  'effortLevels' | 'version' | 'rows' | 'status' | 'sessionTitle' | 'sessionColor' |
  'agentId' | 'sessionId' | 'agentBindingGeneration' | 'model' | 'provider' | 'tokens' | 'cwd' |
  'displayCwd' | 'gitBranch' | 'working' | 'compaction' | 'cancelPending' | 'spinnerMode' |
  'responseChars' | 'activeToolCount' | 'turnStart' | 'lastUserText' |
  'notifications' | 'contextWindow' | 'reasoningEffort' | 'mode' | 'modeIndex' |
  'configuredProvider' | 'configuredModel' | 'configuredPreset' |
  'diffLayout' | 'thinkingFold' | 'jobGroupFold' | 'toolBackground' | 'promptSessionLabel' | 'expandEditor' |
  'agentPreset' | 'goal' | 'todos' | 'loadedContext' | 'pending' | 'commandList' |
  'lastUsage' | 'turnUsage' | 'tps' | 'tpsSamples' | 'contextSegments' | 'mainCost' | 'subagentCost' | 'subagents' | 'backgroundJobs' | 'selection'
> {
  return {
    effortLevels: undefined, version: 0, rows: [], selection: undefined, status: 'starting', sessionTitle: '', sessionColor: '',
    agentId: input.agentId, sessionId: input.sessionId, agentBindingGeneration: 0, model: options.model, provider: options.provider,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, idle: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    cwd: options.cwd, displayCwd: input.cwdDescription, gitBranch: undefined, working: false,
    compaction: undefined,
    cancelPending: false, spinnerMode: 'requesting', responseChars: 0, activeToolCount: 0,
    turnStart: 0, lastUserText: '', notifications: [], contextWindow: undefined,
    reasoningEffort: options.effort, mode: input.mode, modeIndex: 0,
    configuredProvider: options.configuredProvider,
    configuredModel: options.configuredModel, configuredPreset: options.configuredPreset,
    diffLayout: 'auto', thinkingFold: 'preview', jobGroupFold: 'auto', toolBackground: 'none',
    promptSessionLabel: false, expandEditor: false,
    agentPreset: options.agentPreset, goal: undefined,
    todos: [], loadedContext: undefined, pending: [], commandList: [], lastUsage: undefined, turnUsage: undefined,
    tps: undefined, tpsSamples: [], contextSegments: { system: 0, prompt: 0, assistant: 0, thinking: 0, tools: 0 },
    // 费用估算输入：主会话按模型分桶 + 子代理快照。与 tokens 并行累计，
    // tokens 的既有语义/显示不变（DESIGN D2）。
    mainCost: {}, subagentCost: [],
    subagents: [], backgroundJobs: [],
  }
}
