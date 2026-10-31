import { createModuleStore, type Publication, type MutableSnapshot } from '../../../shared/state/module-store.js'
import type { ActivitySnapshot, ActivityCommands } from '../state-contracts.js'
import { BackgroundJobStore, type BackgroundJobEvents } from './jobs.js'
import { SubagentActivityStore } from './subagents.js'
import type { SubagentCostPolicy } from '../model-contracts.js'
import type { ModuleLaunch } from '../../../shared/protocol/module-launch.js'

/** This module is the sole owner of these fields. Writers never reach the UI. */
export function createActivityModule(launch: ModuleLaunch, commands: ActivityCommands, publication: Publication) {
  const owned = createModuleStore<MutableSnapshot<ActivitySnapshot>>({
    subagentCost: [],
    subagents: [],
    backgroundJobs: [],
  }, publication)
  let disposed = false
  const jobReducers = new Set<BackgroundJobStore>()
  const childReducers = new Set<SubagentActivityStore>()
  return {
    store: owned.store,
    commands,
    ingress: {
      patch: owned.patch,
      update: owned.update,
      read: owned.read,
      batch: publication.batch,
      createJobs(events: BackgroundJobEvents) {
        const reducer = new BackgroundJobStore({
          onChanged: () => { if (!disposed) events.onChanged?.() },
          onSettled: job => { if (!disposed) events.onSettled?.(job) },
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
      owned.dispose()
      for (const reducer of jobReducers) reducer.reset()
      for (const reducer of childReducers) reducer.dispose()
      jobReducers.clear()
      childReducers.clear()
    },
  }
}

export type ActivityRuntime = ReturnType<typeof createActivityModule>
