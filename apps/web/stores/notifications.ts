import { defineStore } from 'pinia'

import type { SystemNotificationSnapshot } from '../composables/api/useSystemApi'

interface LocalNotificationInput {
  code?: string
  content: string
  details?: unknown
  level: 'info' | 'warning' | 'error'
}

const createLocalNotification = (input: LocalNotificationInput): SystemNotificationSnapshot => {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    level: input.level,
    content: input.content,
    timestamp: String(Date.now()),
    code: input.code,
    details: input.details
  }
}

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({
    remoteItems: [] as SystemNotificationSnapshot[],
    localItems: [] as SystemNotificationSnapshot[],
    isFetching: false,
    lastSyncedAt: null as number | null,
    lastError: null as string | null
  }),
  getters: {
    items: state => [...state.localItems, ...state.remoteItems],
    unreadCount(): number {
      return this.items.length
    },
    latestItems(): SystemNotificationSnapshot[] {
      return this.items.slice(0, 5)
    },
    hasErrors(): boolean {
      return this.items.some(item => item.level === 'error')
    }
  },
  actions: {
    replaceItems(items: SystemNotificationSnapshot[]) {
      this.remoteItems = items
      this.lastSyncedAt = Date.now()
    },
    pushLocalItem(input: LocalNotificationInput) {
      this.localItems = [createLocalNotification(input), ...this.localItems].slice(0, 20)
    },
    setFetching(isFetching: boolean) {
      this.isFetching = isFetching
    },
    setError(errorMessage: string | null) {
      this.lastError = errorMessage
    },
    clearLocalItems() {
      this.localItems = []
    },
    clearAllItems() {
      this.remoteItems = []
      this.localItems = []
    }
  }
})
