import { createChannelReadView } from './read-view.js'

export interface ReadableStore<Snapshot> {
  getSnapshot(): Readonly<Snapshot>
  subscribe(listener: () => void): () => void
}

interface Participant {
  commit(): boolean
  notify(): void
}

type PublicationMode = 'immediate' | 'stream' | 'silent'

export function createPublication(options: {
  schedule?(callback: () => void): () => void
  onListenerError?(error: unknown): void
} = {}) {
  let active = true
  let depth = 0
  let mode: PublicationMode = 'immediate'
  let notifying = false
  let cancelWake: (() => void) | undefined
  const dirty = new Set<Participant>()
  const waiting = new Set<Participant>()
  const schedule = options.schedule ?? (callback => {
    const timer = setTimeout(callback, 16)
    timer.unref()
    return () => clearTimeout(timer)
  })
  const flush = (): void => {
    cancelWake?.()
    cancelWake = undefined
    if (!active || notifying) return
    notifying = true
    try {
      while (waiting.size > 0 && active) {
        const current = [...waiting]
        waiting.clear()
        for (const participant of current) {
          if (!active) break
          try { participant.notify() } catch (error) {
            if (options.onListenerError) options.onListenerError(error)
            else throw error
          }
        }
      }
    } finally {
      notifying = false
    }
  }
  const commit = (): void => {
    const participants = [...dirty]
    dirty.clear()
    if (participants.length === 0) return
    const changed = participants.filter(participant => participant.commit())
    for (const participant of changed) waiting.add(participant)
    if (mode === 'immediate') flush()
    else if (mode === 'stream' && waiting.size > 0 && cancelWake === undefined) cancelWake = schedule(flush)
  }
  return {
    batch<T>(work: () => T, nextMode: PublicationMode = 'immediate'): T {
      const previousMode = mode
      if (depth === 0) mode = nextMode
      depth++
      try { return work() } finally {
        depth--
        if (depth === 0 && active) commit()
        mode = previousMode
      }
    },
    changed(participant: Participant): void {
      if (!active) return
      dirty.add(participant)
      if (depth === 0) commit()
    },
    flush,
    dispose(): void {
      if (!active) return
      active = false
      cancelWake?.()
      cancelWake = undefined
      dirty.clear()
      waiting.clear()
    },
  }
}

export type Publication = ReturnType<typeof createPublication>

/** Reuse unchanged structured data without serializing opaque image/buffer leaves. */
function retainEqual<T>(next: T, previous: T): T {
  if (Object.is(next, previous)) return previous
  if (next === null || previous === null || typeof next !== 'object' || typeof previous !== 'object') return next
  const proto = Object.getPrototypeOf(next)
  if (!Array.isArray(next) && proto !== null && proto !== Object.prototype) return next
  if (Array.isArray(next) !== Array.isArray(previous)) return next
  const keys = Object.keys(next)
  if (keys.length !== Object.keys(previous).length) return next
  const result = Array.isArray(next) ? [] : Object.create(null)
  let equal = true
  for (const key of keys) {
    const value = Reflect.get(next, key)
    const old = Reflect.get(previous, key)
    const retained = retainEqual(value, old)
    Reflect.set(result, key, retained)
    if (!Object.is(retained, old) || !Object.hasOwn(previous, key)) equal = false
  }
  return equal ? previous : Object.freeze(result) as T
}

/** A module retains its writer; consumers receive only `store`. */
export function createModuleStore<State extends object>(initial: State, publication: Publication, options: { trackedRows?: boolean } = {}) {
  const state = initial
  const listeners = new Set<() => void>()
  let active = true
  let revision = 0
  const project = createChannelReadView(() => {
    if (!active) throw new Error('Module lifetime has ended')
  }, { trackedRows: options.trackedRows ?? false })
  let snapshot: Readonly<State> = project(state, revision)
  let current = snapshot
  const read = (): Readonly<State> => {
    current = retainEqual(project(state, revision), current)
    return current
  }
  const participant: Participant = {
    commit() {
      const previous = snapshot
      snapshot = retainEqual(read(), snapshot)
      return !Object.is(snapshot, previous)
    },
    notify() { if (active) for (const listener of [...listeners]) listener() },
  }
  const store: ReadableStore<State> = Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (!active) return () => undefined
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  })
  return {
    store,
    read,
    patch(patch: Partial<State>): void {
      if (!active) return
      let changed = false
      for (const key of Object.keys(patch) as (keyof State)[]) {
        const value = patch[key] as State[typeof key]
        if (!Object.is(state[key], value)) { state[key] = value; changed = true }
      }
      if (changed) { revision++; publication.changed(participant) }
    },
    update(edit: (draft: State) => void): void {
      if (!active) return
      publication.batch(() => {
        edit(state)
        revision++
        publication.changed(participant)
      })
    },
    dispose(): void { active = false; listeners.clear() },
  }
}

export type MutableSnapshot<Snapshot> = {
  -readonly [Key in keyof Snapshot]: Snapshot[Key] extends readonly (infer Item)[] ? Item[] : Snapshot[Key]
}
