import { useNotificationsStore } from '../../stores/notifications'
import { useRuntimeStore } from '../../stores/runtime'
import { useSystemApi } from '../api/useSystemApi'
import { useVisibilityPolling } from './useVisibilityPolling'

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown operator bootstrap error'
}

export const useOperatorBootstrap = () => {
  const runtime = useRuntimeStore()
  const notifications = useNotificationsStore()
  const systemApi = useSystemApi()

  const syncClock = async () => {
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
    refreshOnVisible: true
  })

  const runtimeStatusPolling = useVisibilityPolling(syncRuntimeStatus, {
    visibleIntervalMs: 5000,
    hiddenIntervalMs: 10000,
    immediate: true,
    refreshOnVisible: true
  })

  const notificationsPolling = useVisibilityPolling(syncNotifications, {
    visibleIntervalMs: 5000,
    hiddenIntervalMs: 10000,
    immediate: true,
    refreshOnVisible: true
  })

  const refreshAll = async () => {
    await Promise.all([syncClock(), syncRuntimeStatus(), syncNotifications()])
  }

  return {
    refreshAll,
    clockPolling,
    runtimeStatusPolling,
    notificationsPolling
  }
}
