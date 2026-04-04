import { useRouteQuery } from '@vueuse/router'
import { computed } from 'vue'

import { normalizeOptionalString } from '../../lib/route/query'

export const normalizeTimelineRouteValue = (value: string | null | undefined): string | null => {
  return normalizeOptionalString(value)
}

export const useTimelineRouteState = () => {
  const eventIdQuery = useRouteQuery<string | null>('event_id', null, { mode: 'replace' })
  const fromTickQuery = useRouteQuery<string | null>('from_tick', null, { mode: 'replace' })
  const toTickQuery = useRouteQuery<string | null>('to_tick', null, { mode: 'replace' })

  const selectedEventId = computed(() => normalizeTimelineRouteValue(eventIdQuery.value))

  const setSelectedEventId = (eventId: string | null) => {
    eventIdQuery.value = normalizeTimelineRouteValue(eventId)
  }

  const setRange = (range: { fromTick?: string | null; toTick?: string | null }) => {
    if ('fromTick' in range) {
      fromTickQuery.value = normalizeTimelineRouteValue(range.fromTick ?? null)
    }

    if ('toTick' in range) {
      toTickQuery.value = normalizeTimelineRouteValue(range.toTick ?? null)
    }
  }

  return {
    selectedEventId,
    range: computed(() => ({
      fromTick: normalizeTimelineRouteValue(fromTickQuery.value),
      toTick: normalizeTimelineRouteValue(toTickQuery.value)
    })),
    setSelectedEventId,
    setRange
  }
}
