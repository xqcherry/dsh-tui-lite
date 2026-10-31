import type { NotificationItem } from './session.js'

export type Notify = (text: string, options?: { color?: NotificationItem['color']; timeoutMs?: number }) => () => void
