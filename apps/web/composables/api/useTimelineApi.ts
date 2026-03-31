import { requestApiData } from '../../lib/http/client'
import type { TickString } from '../../lib/time/tick'

export interface TimelineEventSnapshot {
  id: string
  title: string
  description: string
  tick: TickString
  type: string
  impact_data: string | null
  source_action_intent_id: string | null
  created_at: TickString
}

export const useTimelineApi = () => {
  return {
    listTimeline: () => requestApiData<TimelineEventSnapshot[]>('/api/narrative/timeline')
  }
}
