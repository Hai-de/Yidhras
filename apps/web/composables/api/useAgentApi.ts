import { requestApiData } from '../../lib/http/client'
import type { TickString } from '../../lib/time/tick'

export interface AgentOverviewSnapshot {
  profile: {
    id: string
    name: string
    type: string
    snr: number
    is_pinned: boolean
    created_at: TickString
    updated_at: TickString
  }
  binding_summary: {
    active: Array<{
      binding_id: string
      identity_id: string
      role: string
      status: string
      atmosphere_node_id: string | null
      expires_at: TickString | null
    }>
    atmosphere: Array<{
      binding_id: string
      identity_id: string
      role: string
      status: string
      atmosphere_node_id: string | null
      expires_at: TickString | null
    }>
    counts: {
      total: number
      active: number
      atmosphere: number
    }
  }
  relationship_summary: {
    incoming: Array<{
      id: string
      from_id: string
      from_name: string
      type: string
      weight: number
      updated_at: TickString
    }>
    outgoing: Array<{
      id: string
      to_id: string
      to_name: string
      type: string
      weight: number
      updated_at: TickString
    }>
    counts: {
      incoming: number
      outgoing: number
      total: number
    }
  }
  recent_activity: Array<Record<string, unknown>>
  recent_posts: Array<Record<string, unknown>>
  recent_workflows: Array<Record<string, unknown>>
  recent_events: Array<Record<string, unknown>>
  recent_inference_results: Array<{
    job_id: string
    inference_id: string | null
    strategy: string | null
    workflow_state: string
    intent_type: string | null
    outcome_summary: Record<string, unknown> | null
    decision: Record<string, unknown> | null
    created_at: TickString
  }>
  snr: {
    current: number
    recent_logs: Array<{
      id: string
      operation: string
      requested_value: number
      baseline_value: number
      resolved_value: number
      reason: string | null
      created_at: TickString
    }>
  }
  memory: {
    summary: {
      recent_trace_count: number
      latest_memory_context: Record<string, unknown> | null
      latest_memory_selection: Record<string, unknown> | null
      latest_prompt_processing_trace: Record<string, unknown> | null
    }
  }
}

export const useAgentApi = () => {
  return {
    getOverview: (entityId: string, limit = 10) =>
      requestApiData<AgentOverviewSnapshot>(`/api/entities/${entityId}/overview?limit=${limit}`)
  }
}
