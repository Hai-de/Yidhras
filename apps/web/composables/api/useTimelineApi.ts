import { requestApiData } from '../../lib/http/client'
import { resolvePackId } from '../shared/resolvePackId'

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

export const useTimelineApi = () => {

  return {
    listTimeline: () =>
      requestApiData<PackNarrativeProjectionSnapshot>('/api/packs/projections/timeline', {
        packId: resolvePackId()
      })
  }
}
