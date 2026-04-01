export const formatFreshnessLabel = (
  lastSyncedAt: number | null,
  options?: {
    idleLabel?: string
    syncingLabel?: string
    isSyncing?: boolean
  }
): string => {
  const resolvedOptions = options ?? {}

  if (resolvedOptions.isSyncing) {
    return resolvedOptions.syncingLabel ?? 'Refreshing…'
  }

  if (!lastSyncedAt) {
    return resolvedOptions.idleLabel ?? 'Awaiting first sync'
  }

  const formatted = new Date(lastSyncedAt).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

  return `Last synced ${formatted}`
}
