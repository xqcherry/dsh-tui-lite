/** Read host configuration without sending a request or exposing a credential. */
export interface ModelConfigurationHost {
  llm?: {
    listModels(provider: string): Promise<readonly { id: string }[]>
    listConfigurableProviders?(): readonly { provider: string; settingsNs: string; settingsPath: readonly string[] }[]
  }
  settings?: { describe(): readonly { ns: string; value?: unknown }[] }
  credentials?: { resolve(ref: string): Promise<string | undefined> }
  auth?: { providers(): Promise<readonly { provider: string; signedIn: boolean }[]> }
}

export async function isModelConfigured(host: ModelConfigurationHost, provider: string, model: string): Promise<boolean> {
  if (!host.llm || !provider || !model) return false
  const models = await host.llm.listModels(provider)
  if (!models.some(entry => entry.id === model)) return false
  const account = (await host.auth?.providers())?.find(entry => entry.provider === provider)
  if (account) return account.signedIn
  const directory = host.llm.listConfigurableProviders?.().find(entry => entry.provider === provider)
  let profile: unknown = directory && host.settings?.describe().find(section => section.ns === directory.settingsNs)?.value
  for (const key of directory?.settingsPath ?? []) {
    profile = profile !== null && typeof profile === 'object' ? (profile as Record<string, unknown>)[key] : undefined
  }
  if (profile !== null && typeof profile === 'object') {
    const values = profile as Record<string, unknown>
    if (typeof values.apiKey === 'string' && values.apiKey !== '') return true
    if (typeof values.apiKeyEnv === 'string' && values.apiKeyEnv !== '') {
      return Boolean(await host.credentials?.resolve(values.apiKeyEnv))
    }
    // Explicit local endpoints may deliberately need no API key.
    return true
  }
  if (provider === 'deepseek-official') return Boolean(await host.credentials?.resolve('DEEPSEEK_API_KEY'))
  // Other adapters own their own authentication. Registration is the available
  // host contract when they expose neither settings nor an account status.
  return directory === undefined
}
