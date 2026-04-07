import { requestApiData } from '../../lib/http/client'

export interface TimelineEventSnapshot {
  id: string
  kind: 'event' | 'rule_execution'
  created_at: string
  title: string
  description: string
  refs: Record<string, string | null>
  data: Record<string, unknown>
}

export interface PackNarrativeProjectionSnapshot {
  pack: {
    id: string
    name: string
    version: string
  }
  timeline: TimelineEventSnapshot[]
}

const DEFAULT_TIMELINE_PACK_ID = 'world-death-note'

export const useTimelineApi = () => {
  return {
    listTimeline: (packId = DEFAULT_TIMELINE_PACK_ID) =>
      requestApiData<PackNarrativeProjectionSnapshot>(`/api/packs/${packId}/projections/timeline`)
  }
}
