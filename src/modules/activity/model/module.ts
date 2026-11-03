import { createCommandLifetime } from '../../../shared/lifecycle/module-commands.js'
import type { ActivityCommandHost } from '../contracts.js'
import { createModuleStore, type Publication, type MutableSnapshot } from '../../../shared/state/module-store.js'
import type { ActivitySnapshot, ActivityCommands } from '../state-contracts.js'
import { BackgroundJobStore, type BackgroundJobEvents } from './jobs.js'
import { SubagentActivityStore } from './subagents.js'
import type { SubagentCostPolicy } from '../model-contracts.js'
import type { ModuleLaunch } from '../../../shared/protocol/module-launch.js'

/** This module is the sole owner of these fields. Writers never reach the UI. */
export function createActivityModule(launch: ModuleLaunch, publication: Publication) {
  const lifetime = createCommandLifetime<ActivityCommandHost>(publication)
  const owned = createModuleStore<MutableSnapshot<ActivitySnapshot>>({
    subagentCost: [],
    subagents: [],
    backgroundJobs: [],
  }, publication)
  let disposed = false
  const jobReducers = new Set<BackgroundJobStore>()
  const childReducers = new Set<SubagentActivityStore>()
  type MessageControl = NonNullable<ActivityCommands['subagentControl']['message']>
  const withMessage = <Result>(work: (control: MessageControl) => Result): Result => lifetime.call(host => {
    const control = host.subagentControl.message
    if (control === undefined) throw new Error('Subagent message transport is unavailable')
    return work(control)
  })
  const message = Object.freeze<MessageControl>({
    get via() { return withMessage(control => control.via) },
    get steer() { return withMessage(control => control.steer) },
    listTargets: (...args) => withMessage(control => control.listTargets(...args)),
    submit: (...args) => withMessage(control => control.submit(...args)),
    messages: (...args) => withMessage(control => control.messages(...args)),
  })
  const history: NonNullable<ActivityCommands['subagentControl']['history']> = (...args) => lifetime.call(host => {
    const history = host.subagentControl.history
    if (history === undefined) throw new Error('Subagent transcript source is unavailable')
    return history.call(host.subagentControl, ...args)
  })
  const watchOutput: NonNullable<ActivityCommands['jobControl']['watchOutput']> = (...args) => lifetime.call(host => {
    const watch = host.jobControl.watchOutput
    if (watch === undefined) throw new Error('Job output subscription is unavailable')
    return watch.call(host.jobControl, ...args)
  })
  const commands = Object.freeze<ActivityCommands>({
    listSubagents: (...args) => lifetime.call(host => host.listSubagents(...args)),
    jobControl: Object.freeze<ActivityCommands['jobControl']>({
      kill: (...args) => lifetime.call(host => host.jobControl.kill(...args)),
      get watchOutput() { return lifetime.call(host => host.jobControl.watchOutput === undefined ? undefined : watchOutput) },
    }),
    subagentControl: Object.freeze<ActivityCommands['subagentControl']>({
      interrupt: (...args) => lifetime.call(host => host.subagentControl.interrupt(...args)),
      get history() { return lifetime.call(host => host.subagentControl.history === undefined ? undefined : history) },
      get message() { return lifetime.call(host => host.subagentControl.message === undefined ? undefined : message) },
    }),
  })
  return {
    connectHost: lifetime.connect,
    startCommands: lifetime.start,
    store: owned.store,
    commands,
    ingress: {
      setBackgroundJobs(backgroundJobs: ActivitySnapshot['backgroundJobs']): void { owned.patch({ backgroundJobs: [...backgroundJobs] }) },
      setSubagentSnapshot(subagents: ActivitySnapshot['subagents'], subagentCost: ActivitySnapshot['subagentCost']): void { owned.patch({ subagents: [...subagents], subagentCost: [...subagentCost] }) },
      read: owned.read,
      batch: publication.batch,
      resetSessionCost(): void { owned.patch({ subagentCost: [] }) },
      createJobs(events: BackgroundJobEvents) {
        const reducer = new BackgroundJobStore({
          onChanged: () => { if (!disposed) events.onChanged?.() },
        })
        jobReducers.add(reducer)
        return reducer
      },
      createSubagents(policy: SubagentCostPolicy) {
        const reducer = new SubagentActivityStore(policy)
        childReducers.add(reducer)
        return reducer
      },
      releaseSubagents(reducer: SubagentActivityStore) {
        childReducers.delete(reducer)
        reducer.dispose()
      },
    },
    dispose() {
      if (disposed) return
      disposed = true
      lifetime.dispose()
      owned.dispose()
      for (const reducer of jobReducers) reducer.reset()
      for (const reducer of childReducers) reducer.dispose()
      jobReducers.clear()
      childReducers.clear()
    },
  }
}

export type ActivityRuntime = ReturnType<typeof createActivityModule>
