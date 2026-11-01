export interface ConfigurationIdentity {
  readonly generation: number
  readonly provider: string
  readonly model: string
}

export interface ConfigurationCheckHost {
  read(): ConfigurationIdentity
  probe?: () => Promise<boolean>
  publish(ready: boolean): void
}

/** Readiness belongs to a route and binding, and never survives its owner. */
export function createConfigurationCheck(host: ConfigurationCheckHost) {
  let operation = 0
  let disposed = false
  return {
    async refresh(): Promise<void> {
      if (!host.probe || disposed) return
      const capture = host.read()
      const check = ++operation
      host.publish(false)
      const current = (): boolean => {
        const value = host.read()
        return !disposed && check === operation && capture.generation === value.generation
          && capture.provider === value.provider && capture.model === value.model
      }
      try {
        const ready = await host.probe()
        if (current()) host.publish(ready)
      } catch {
        if (current()) host.publish(false)
      }
    },
    dispose(): void { disposed = true; operation++ },
  }
}
