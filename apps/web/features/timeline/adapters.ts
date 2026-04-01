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

export const toTimelineEventCardViewModel = (
  event: TimelineEventSnapshot
): TimelineEventCardViewModel => {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    meta: `${event.type} · tick ${event.tick}`,
    type: event.type,
    tick: event.tick,
    sourceActionIntentId: event.source_action_intent_id
  }
}

export const buildTimelineDetailFields = (event: TimelineEventCardViewModel): TimelineEventDetailField[] => {
  return [
    { label: 'event_id', value: event.id },
    { label: 'type', value: event.type },
    { label: 'tick', value: event.tick },
    { label: 'linked_intent', value: event.sourceActionIntentId ?? '—' }
  ]
}
