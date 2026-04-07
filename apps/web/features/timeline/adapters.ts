import type { TimelineEventSnapshot } from '../../composables/api/useTimelineApi'

export interface TimelineEventCardViewModel {
  id: string
  title: string
  description: string
  meta: string
  type: string
  tick: string
  sourceActionIntentId: string | null
}

export interface TimelineEventDetailField {
  label: string
  value: string
}

const readString = (value: unknown, fallback = '—'): string => {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

export const toTimelineEventCardViewModel = (
  event: TimelineEventSnapshot
): TimelineEventCardViewModel => {
  const tick = typeof event.data.tick === 'string' ? event.data.tick : event.created_at
  const type = typeof event.data.type === 'string' ? event.data.type : event.kind
  const sourceActionIntentId = typeof event.refs.action_intent_id === 'string' ? event.refs.action_intent_id : null

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    meta: `${type} · tick ${tick}`,
    type,
    tick,
    sourceActionIntentId
  }
}

export const buildTimelineDetailFields = (event: TimelineEventCardViewModel): TimelineEventDetailField[] => {
  return [
    { label: 'event_id', value: event.id },
    { label: 'type', value: readString(event.type) },
    { label: 'tick', value: readString(event.tick) },
    { label: 'linked_intent', value: event.sourceActionIntentId ?? '—' }
  ]
}
