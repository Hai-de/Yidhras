import { computed, ref, watch } from 'vue'

import { useTimelineApi } from '../../../composables/api/useTimelineApi'
import { useVisibilityPolling } from '../../../composables/app/useVisibilityPolling'
import { useNotificationsStore } from '../../../stores/notifications'
import { useRuntimeStore } from '../../../stores/runtime'
import { useOperatorNavigation } from '../../shared/navigation'
import { useOperatorSourceContext } from '../../shared/source-context'
import type { TimelineEventCardViewModel } from '../adapters'
import { toTimelineEventCardViewModel } from '../adapters'
import { useTimelineRouteState } from '../route'

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown timeline error'
}

const compareTickStrings = (left: string, right: string): number => {
  if (left.length !== right.length) {
    return left.length > right.length ? 1 : -1
  }

  if (left === right) {
    return 0
  }

  return left > right ? 1 : -1
}

const matchesTickRange = (tick: string, fromTick: string | null, toTick: string | null): boolean => {
  if (fromTick && compareTickStrings(tick, fromTick) < 0) {
    return false
  }

  if (toTick && compareTickStrings(tick, toTick) > 0) {
    return false
  }

  return true
}

export const useTimelinePage = () => {
  const timelineApi = useTimelineApi()
  const timelineRoute = useTimelineRouteState()
  const navigation = useOperatorNavigation()
  const sourceContext = useOperatorSourceContext()
  const notifications = useNotificationsStore()
  const runtimeStore = useRuntimeStore()

  const items = ref<TimelineEventCardViewModel[]>([])
  const isFetching = ref(false)
  const errorMessage = ref<string | null>(null)
  const lastSyncedAt = ref<number | null>(null)

  const fetchTimeline = async () => {
    isFetching.value = true

    try {
      const packId = runtimeStore.worldPack?.id ?? 'death_note'
      const snapshot = await timelineApi.listTimeline(packId)
      const filteredItems = snapshot.timeline.filter(event =>
        matchesTickRange(
          typeof event.data.tick === 'string' ? event.data.tick : event.created_at,
          timelineRoute.range.value.fromTick,
          timelineRoute.range.value.toTick
        )
      )
      items.value = filteredItems.map(toTimelineEventCardViewModel)
      errorMessage.value = null
      lastSyncedAt.value = Date.now()
    } catch (error) {
      const message = getErrorMessage(error)
      errorMessage.value = message
      notifications.pushLocalItem({
        level: 'warning',
        content: `Timeline refresh failed: ${message}`,
        code: 'timeline_refresh_failed'
      })
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

  const mappingHint = computed(() => sourceContext.socialSemanticHint.value)

  const selectEvent = (event: TimelineEventCardViewModel) => {
    timelineRoute.setSelectedEventId(event.id)
  }

  const openWorkflow = (actionIntentId: string, eventId?: string) => {
    void navigation.goToWorkflowActionIntent(actionIntentId, 'intent', {
      sourcePage: 'timeline',
      ...(eventId ? { sourceEventId: eventId } : selectedEvent.value ? { sourceEventId: selectedEvent.value.id } : {})
    })
  }

  const openSocial = (event: TimelineEventCardViewModel) => {
    void navigation.goToSocialFeed({
      keyword: event.sourceActionIntentId ? null : event.title,
      sourceActionIntentId: event.sourceActionIntentId,
      fromTick: event.tick,
      toTick: event.tick,
      context: {
        sourcePage: 'timeline',
        sourceEventId: event.id
      }
    })
  }

  const returnToSource = () => {
    if (sourceContext.source.value.sourcePage === 'social' && sourceContext.source.value.sourcePostId) {
      void navigation.goToSocialPost(sourceContext.source.value.sourcePostId)
      return
    }

    if (sourceContext.source.value.sourcePage === 'graph' && sourceContext.source.value.sourceRootId) {
      void navigation.goToGraphRoot(sourceContext.source.value.sourceRootId, {
        ...(sourceContext.source.value.sourceNodeId
          ? { selectedNodeId: sourceContext.source.value.sourceNodeId }
          : {})
      })
    }
  }

  return {
    items,
    selectedEvent,
    isFetching,
    errorMessage,
    lastSyncedAt,
    range: timelineRoute.range,
    selectedEventId: timelineRoute.selectedEventId,
    setRange: timelineRoute.setRange,
    selectEvent,
    openWorkflow,
    openSocial,
    refresh: fetchTimeline,
    sourceSummary: sourceContext.summary,
    mappingHint,
    hasSource: sourceContext.hasSource,
    returnToSource
  }
}
