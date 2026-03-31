import { useDocumentVisibility } from '@vueuse/core'
import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'
import { computed, onScopeDispose, ref, toValue, watch } from 'vue'

export interface VisibilityPollingOptions {
  visibleIntervalMs: number
  hiddenIntervalMs?: number | null
  enabled?: MaybeRefOrGetter<boolean>
  immediate?: boolean
  refreshOnVisible?: boolean
}

export interface VisibilityPollingController {
  isEnabled: ComputedRef<boolean>
  isPending: Ref<boolean>
  isPolling: ComputedRef<boolean>
  visibility: Ref<'visible' | 'hidden' | 'prerender' | undefined>
  refresh: () => Promise<void>
  restart: (options?: { immediate?: boolean }) => Promise<void>
  stop: () => void
}

export const useVisibilityPolling = (
  task: () => Promise<void>,
  options: VisibilityPollingOptions
): VisibilityPollingController => {
  const visibility = useDocumentVisibility()
  const isEnabled = computed(() => toValue(options.enabled ?? true))
  const isPending = ref(false)
  const timerId = ref<ReturnType<typeof setTimeout> | null>(null)
  const isPolling = computed(() => timerId.value !== null)

  let isInitialized = false
  let previousVisibility = visibility.value

  const clearPollingTimer = () => {
    if (timerId.value !== null) {
      clearTimeout(timerId.value)
      timerId.value = null
    }
  }

  const resolveInterval = (): number | null => {
    if (visibility.value === 'visible') {
      return options.visibleIntervalMs
    }

    return options.hiddenIntervalMs ?? null
  }

  const refresh = async () => {
    if (!isEnabled.value || isPending.value) {
      return
    }

    isPending.value = true

    try {
      await task()
    } finally {
      isPending.value = false
    }
  }

  const scheduleNext = () => {
    const intervalMs = resolveInterval()
    if (!isEnabled.value || intervalMs === null) {
      clearPollingTimer()
      return
    }

    timerId.value = setTimeout(async () => {
      timerId.value = null
      await refresh()
      scheduleNext()
    }, intervalMs)
  }

  const restart = async (restartOptions?: { immediate?: boolean }) => {
    clearPollingTimer()

    if (!isEnabled.value) {
      previousVisibility = visibility.value
      isInitialized = true
      return
    }

    if (restartOptions?.immediate === true) {
      await refresh()
    }

    previousVisibility = visibility.value
    isInitialized = true
    scheduleNext()
  }

  watch(
    [visibility, isEnabled],
    async ([nextVisibility, enabled]) => {
      const becameVisible =
        isInitialized && previousVisibility !== 'visible' && nextVisibility === 'visible'
      const shouldRefreshImmediately =
        (!isInitialized && (options.immediate ?? false)) ||
        (becameVisible && (options.refreshOnVisible ?? true))

      if (!enabled) {
        clearPollingTimer()
        previousVisibility = nextVisibility
        isInitialized = true
        return
      }

      await restart({ immediate: shouldRefreshImmediately })
    },
    { immediate: true }
  )

  onScopeDispose(() => {
    clearPollingTimer()
  })

  return {
    isEnabled,
    isPending,
    isPolling,
    visibility,
    refresh,
    restart,
    stop: clearPollingTimer
  }
}
