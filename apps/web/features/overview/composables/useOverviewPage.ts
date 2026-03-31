import { ref } from 'vue'

import type { OverviewSummarySnapshot } from '../../../composables/api/useOverviewApi'
import { useOverviewApi } from '../../../composables/api/useOverviewApi'
import { useVisibilityPolling } from '../../../composables/app/useVisibilityPolling'

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown overview error'
}

export const useOverviewPage = () => {
  const overviewApi = useOverviewApi()
  const summary = ref<OverviewSummarySnapshot | null>(null)
  const isFetching = ref(false)
  const errorMessage = ref<string | null>(null)

  const fetchSummary = async () => {
    isFetching.value = true

    try {
      summary.value = await overviewApi.getSummary()
      errorMessage.value = null
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      isFetching.value = false
    }
  }

  const polling = useVisibilityPolling(fetchSummary, {
    visibleIntervalMs: 10000,
    hiddenIntervalMs: 20000,
    immediate: true,
    refreshOnVisible: true
  })

  return {
    summary,
    isFetching,
    errorMessage,
    refresh: polling.refresh
  }
}
