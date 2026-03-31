import { defineStore } from 'pinia'

import type { SystemNotificationSnapshot } from '../composables/api/useSystemApi'

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({
    items: [] as SystemNotificationSnapshot[],
    isFetching: false,
    lastSyncedAt: null as number | null,
    lastError: null as string | null
  }),
  getters: {
    unreadCount: state => state.items.length,
    latestItems: state => state.items.slice(0, 5),
    hasErrors: state => state.items.some(item => item.level === 'error')
  },
  actions: {
    replaceItems(items: SystemNotificationSnapshot[]) {
      this.items = items
      this.lastSyncedAt = Date.now()
    },
    setFetching(isFetching: boolean) {
      this.isFetching = isFetching
    },
    setError(errorMessage: string | null) {
      this.lastError = errorMessage
    },
    clearLocalItems() {
      this.items = []
    }
  }
})
