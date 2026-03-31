import type { TimelineEventSnapshot } from '../../composables/api/useTimelineApi'

export interface TimelineEventCardViewModel {
  id: string
  title: string
  description: string
  meta: string
  type: string
  sourceActionIntentId: string | null
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
    sourceActionIntentId: event.source_action_intent_id
  }
}
