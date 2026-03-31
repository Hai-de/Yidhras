import { useRouteQuery } from '@vueuse/router'
import { computed } from 'vue'

const normalizeOptionalString = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const useTimelineRouteState = () => {
  const eventIdQuery = useRouteQuery<string | null>('event_id', null, { mode: 'replace' })
  const fromTickQuery = useRouteQuery<string | null>('from_tick', null, { mode: 'replace' })
  const toTickQuery = useRouteQuery<string | null>('to_tick', null, { mode: 'replace' })

  const selectedEventId = computed(() => normalizeOptionalString(eventIdQuery.value))

  const setSelectedEventId = (eventId: string | null) => {
    eventIdQuery.value = normalizeOptionalString(eventId)
  }

  const setRange = (range: { fromTick?: string | null; toTick?: string | null }) => {
    if ('fromTick' in range) {
      fromTickQuery.value = normalizeOptionalString(range.fromTick ?? null)
    }

    if ('toTick' in range) {
      toTickQuery.value = normalizeOptionalString(range.toTick ?? null)
    }
  }

  return {
    selectedEventId,
    range: computed(() => ({
      fromTick: normalizeOptionalString(fromTickQuery.value),
      toTick: normalizeOptionalString(toTickQuery.value)
    })),
    setSelectedEventId,
    setRange
  }
}
