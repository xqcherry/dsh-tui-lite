import type { Notify } from '../../../shared/protocol/notifications.js'
import type { NotificationItem } from '../../../shared/protocol/session.js'
import type { ChannelOwner } from '../../../shared/lifecycle/owner.js'

/** Own expiry and explicit dismissal in the same bounded notification scope. */
export function createChannelNotifications(
  workbench: { ingress: { update(edit: (draft: { notifications: NotificationItem[] }) => void): void } },
  owner: ChannelOwner,
): Notify {
  let sequence = 0
  return (text, options = {}) => {
    owner.assertActive()
    const item: NotificationItem = { id: sequence++, text, color: options.color, timeoutMs: options.timeoutMs ?? 4000 }
    workbench.ingress.update(draft => { draft.notifications.push(item) })
    let timer: ReturnType<typeof setTimeout> | undefined
    const release = owner.own(() => {
      if (timer !== undefined) clearTimeout(timer)
      workbench.ingress.update(draft => {
        const index = draft.notifications.indexOf(item)
        if (index >= 0) draft.notifications.splice(index, 1)
      })
    })
    if (item.timeoutMs > 0) timer = setTimeout(release, item.timeoutMs)
    return release
  }
}
