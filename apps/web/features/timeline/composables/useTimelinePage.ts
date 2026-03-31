import { computed, ref, watch } from 'vue'

import { useTimelineApi } from '../../../composables/api/useTimelineApi'
import { useVisibilityPolling } from '../../../composables/app/useVisibilityPolling'
import { useOperatorNavigation } from '../../shared/navigation'
import type { TimelineEventCardViewModel } from '../adapters'
import { toTimelineEventCardViewModel } from '../adapters'
import { useTimelineRouteState } from '../route'

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown timeline error'
}

const matchesTickRange = (tick: string, fromTick: string | null, toTick: string | null): boolean => {
  if (fromTick && BigInt(tick) < BigInt(fromTick)) {
    return false
  }

  if (toTick && BigInt(tick) > BigInt(toTick)) {
    return false
  }

  return true
}

export const useTimelinePage = () => {
  const timelineApi = useTimelineApi()
  const timelineRoute = useTimelineRouteState()
  const navigation = useOperatorNavigation()

  const items = ref<TimelineEventCardViewModel[]>([])
  const isFetching = ref(false)
  const errorMessage = ref<string | null>(null)

  const fetchTimeline = async () => {
    isFetching.value = true

    try {
      const snapshot = await timelineApi.listTimeline()
      const filteredItems = snapshot.filter(event =>
        matchesTickRange(event.tick, timelineRoute.range.value.fromTick, timelineRoute.range.value.toTick)
      )
      items.value = filteredItems.map(toTimelineEventCardViewModel)
      errorMessage.value = null
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      isFetching.value = false
    }
  }

  useVisibilityPolling(fetchTimeline, {
    visibleIntervalMs: 15000,
    hiddenIntervalMs: 30000,
    immediate: false,
    refreshOnVisible: true
  })

  watch(
    () => timelineRoute.range.value,
    () => {
      void fetchTimeline()
    },
    { deep: true, immediate: true }
  )

  const selectedEvent = computed(() => {
    if (!timelineRoute.selectedEventId.value) {
      return null
    }

    return items.value.find(item => item.id === timelineRoute.selectedEventId.value) ?? null
  })

  const selectEvent = (event: TimelineEventCardViewModel) => {
    timelineRoute.setSelectedEventId(event.id)
  }

  const openWorkflow = (actionIntentId: string) => {
    void navigation.goToWorkflowActionIntent(actionIntentId, 'intent')
  }

  return {
    items,
    selectedEvent,
    isFetching,
    errorMessage,
    range: timelineRoute.range,
    selectedEventId: timelineRoute.selectedEventId,
    setRange: timelineRoute.setRange,
    selectEvent,
    openWorkflow,
    refresh: fetchTimeline
  }
}
