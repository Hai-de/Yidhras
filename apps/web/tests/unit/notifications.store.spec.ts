import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useNotificationsStore } from '../../stores/notifications'

describe('useNotificationsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('aggregates counts and latest items across local and remote notifications', () => {
    const notifications = useNotificationsStore()

    notifications.replaceItems([
      {
        id: 'remote-warning',
        level: 'warning',
        content: 'remote warning',
        timestamp: '100',
        code: 'REMOTE_WARNING',
        details: null
      },
      {
        id: 'remote-info',
        level: 'info',
        content: 'remote info',
        timestamp: '90',
        code: 'REMOTE_INFO',
        details: null
      }
    ])

    notifications.pushLocalItem({
      level: 'error',
      content: 'local error',
      code: 'LOCAL_ERROR'
    })

    expect(notifications.unreadCount).toBe(3)
    expect(notifications.errorCount).toBe(1)
    expect(notifications.warningCount).toBe(1)
    expect(notifications.infoCount).toBe(1)
    expect(notifications.hasErrors).toBe(true)
    expect(notifications.latestItems).toHaveLength(3)
    expect(notifications.latestError?.code).toBe('LOCAL_ERROR')
    expect(notifications.latestWarnings.map(item => item.code)).toEqual(['REMOTE_WARNING'])
  })

  it('clears local and all notification buckets independently', () => {
    const notifications = useNotificationsStore()

    notifications.replaceItems([
      {
        id: 'remote-warning',
        level: 'warning',
        content: 'remote warning',
        timestamp: '100',
        code: 'REMOTE_WARNING',
        details: null
      }
    ])
    notifications.pushLocalItem({
      level: 'info',
      content: 'local info',
      code: 'LOCAL_INFO'
    })

    notifications.clearLocalItems()
    expect(notifications.localItems).toEqual([])
    expect(notifications.remoteItems).toHaveLength(1)

    notifications.clearAllItems()
    expect(notifications.localItems).toEqual([])
    expect(notifications.remoteItems).toEqual([])
  })
})
