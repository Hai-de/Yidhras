import { requestApiData } from '../../lib/http/client'
import type { TickString } from '../../lib/time/tick'

export type SchedulerKind = 'periodic' | 'event_driven'
export type SchedulerReason =
  | 'periodic_tick'
  | 'bootstrap_seed'
  | 'event_followup'
  | 'relationship_change_followup'
  | 'snr_change_followup'
export type SchedulerSkipReason =
  | 'pending_workflow'
  | 'periodic_cooldown'
  | 'event_coalesced'
  | 'existing_same_idempotency'
  | 'limit_reached'

export interface SchedulerRunSummary {
  id: string
  worker_id: string
  tick: TickString
  summary: {
    scanned_count: number
    eligible_count: number
    created_count: number
    skipped_pending_count: number
    skipped_cooldown_count: number
    created_periodic_count: number
    created_event_driven_count: number
    signals_detected_count: number
    scheduled_for_future_count: number
    skipped_existing_idempotency_count: number
    skipped_by_reason: Record<SchedulerSkipReason, number>
    scheduler_run_id?: string
  }
  started_at: TickString
  finished_at: TickString
  created_at: TickString
}

export interface SchedulerDecisionItem {
  id: string
  actor_id: string
  kind: SchedulerKind
  candidate_reasons: SchedulerReason[]
  chosen_reason: SchedulerReason
  scheduled_for_tick: TickString
  priority_score: number
  skipped_reason: SchedulerSkipReason | null
  created_job_id: string | null
  created_at: TickString
}

export interface SchedulerRunsSnapshot {
  items: SchedulerRunSummary[]
  page_info: {
    has_next_page: boolean
    next_cursor: string | null
  }
  summary: {
    returned: number
    limit: number
    filters: {
      cursor: string | null
      from_tick: TickString | null
      to_tick: TickString | null
      worker_id: string | null
    }
  }
}

export interface SchedulerDecisionsSnapshot {
  items: SchedulerDecisionItem[]
  page_info: {
    has_next_page: boolean
    next_cursor: string | null
  }
  summary: {
    returned: number
    limit: number
    filters: {
      cursor: string | null
      actor_id: string | null
      kind: SchedulerKind | null
      reason: SchedulerReason | null
      skipped_reason: SchedulerSkipReason | null
      from_tick: TickString | null
      to_tick: TickString | null
    }
  }
}

export interface SchedulerRunReadModel {
  run: SchedulerRunSummary
  candidates: SchedulerDecisionItem[]
}

export interface SchedulerRunsQueryInput {
  limit?: number
  cursor?: string | null
  fromTick?: TickString | null
  toTick?: TickString | null
  workerId?: string | null
}

export interface SchedulerDecisionsQueryInput {
  limit?: number
  cursor?: string | null
  actorId?: string | null
  kind?: SchedulerKind | null
  reason?: SchedulerReason | null
  skippedReason?: SchedulerSkipReason | null
  fromTick?: TickString | null
  toTick?: TickString | null
}

const normalizeOptionalString = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const buildQueryString = (input: Record<string, string | number | null | undefined>): string => {
  const searchParams = new URLSearchParams()

  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined || value === '') {
      continue
    }
    searchParams.set(key, String(value))
  }

  const queryString = searchParams.toString()
  return queryString.length > 0 ? `?${queryString}` : ''
}

export const useSchedulerApi = () => {
  return {
    listRuns: (input: SchedulerRunsQueryInput = {}) =>
      requestApiData<SchedulerRunsSnapshot>(
        `/api/runtime/scheduler/runs${buildQueryString({
          limit: input.limit,
          cursor: normalizeOptionalString(input.cursor),
          from_tick: normalizeOptionalString(input.fromTick),
          to_tick: normalizeOptionalString(input.toTick),
          worker_id: normalizeOptionalString(input.workerId)
        })}`
      ),
    getLatestRun: () => requestApiData<SchedulerRunReadModel | null>('/api/runtime/scheduler/runs/latest'),
    getRunById: (runId: string) => requestApiData<SchedulerRunReadModel | null>(`/api/runtime/scheduler/runs/${runId}`),
    listDecisions: (input: SchedulerDecisionsQueryInput = {}) =>
      requestApiData<SchedulerDecisionsSnapshot>(
        `/api/runtime/scheduler/decisions${buildQueryString({
          limit: input.limit,
          cursor: normalizeOptionalString(input.cursor),
          actor_id: normalizeOptionalString(input.actorId),
          kind: input.kind,
          reason: input.reason,
          skipped_reason: input.skippedReason,
          from_tick: normalizeOptionalString(input.fromTick),
          to_tick: normalizeOptionalString(input.toTick)
        })}`
      ),
    listAgentDecisions: (agentId: string) => requestApiData<SchedulerDecisionItem[]>(`/api/agent/${agentId}/scheduler`)
  }
}
