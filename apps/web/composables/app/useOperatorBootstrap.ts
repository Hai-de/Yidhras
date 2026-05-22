import { storeToRefs } from 'pinia'
import { computed } from 'vue'

import { useAuthStore } from '../../stores/auth'
import { useNotificationsStore } from '../../stores/notifications'
import { useRuntimeStore } from '../../stores/runtime'
import { useSystemApi } from '../api/useSystemApi'
import { resolvePackId } from '../shared/resolvePackId'
import { useVisibilityPolling } from './useVisibilityPolling'

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown operator bootstrap error'
}

export const useOperatorBootstrap = () => {
  const auth = useAuthStore()
  const { isAuthenticated } = storeToRefs(auth)
  const runtime = useRuntimeStore()
  const notifications = useNotificationsStore()
  const systemApi = useSystemApi()
  const hasResolvedPack = computed(() => Boolean(resolvePackId()))
  const isPackRuntimePollingEnabled = computed(() => isAuthenticated.value && hasResolvedPack.value)

  const syncClock = async () => {
    if (!resolvePackId()) return
    runtime.setClockSyncing(true)

    try {
      const clockSnapshot = await systemApi.getFormattedClock()
      runtime.applyClockSnapshot(clockSnapshot)
      runtime.setClockError(null)
    } catch (error) {
      runtime.setClockError(getErrorMessage(error))
    } finally {
      runtime.setClockSyncing(false)
    }
  }

  const syncRuntimeStatus = async () => {
    if (!resolvePackId()) return
    runtime.setStatusSyncing(true)

    try {
      const runtimeSnapshot = await systemApi.getRuntimeStatus()
      runtime.applyRuntimeStatusSnapshot(runtimeSnapshot)
      runtime.setStatusError(null)
    } catch (error) {
      runtime.setStatusError(getErrorMessage(error))
    } finally {
      runtime.setStatusSyncing(false)
    }
  }

  const syncNotifications = async () => {
    notifications.setFetching(true)

    try {
      const notificationItems = await systemApi.listNotifications()
      notifications.replaceItems(notificationItems)
      notifications.setError(null)
    } catch (error) {
      notifications.setError(getErrorMessage(error))
    } finally {
      notifications.setFetching(false)
    }
  }

  const clockPolling = useVisibilityPolling(syncClock, {
    visibleIntervalMs: 1000,
    hiddenIntervalMs: 2000,
    immediate: true,
    refreshOnVisible: true,
    enabled: isAuthenticated
  })

  const runtimeStatusPolling = useVisibilityPolling(syncRuntimeStatus, {
    visibleIntervalMs: 5000,
    hiddenIntervalMs: 10000,
    immediate: true,
    refreshOnVisible: true,
    enabled: isPackRuntimePollingEnabled
  })

  const notificationsPolling = useVisibilityPolling(syncNotifications, {
    visibleIntervalMs: 5000,
    hiddenIntervalMs: 10000,
    immediate: true,
    refreshOnVisible: true,
    enabled: isAuthenticated
  })

  const refreshAll = async () => {
    await Promise.all([syncClock(), hasResolvedPack.value ? syncRuntimeStatus() : Promise.resolve(), syncNotifications()])
  }

  return {
    refreshAll,
    clockPolling,
    runtimeStatusPolling,
    notificationsPolling
  }
}
