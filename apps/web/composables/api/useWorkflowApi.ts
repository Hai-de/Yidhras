import { requestApiData } from '../../lib/http/client'
import { normalizeOptionalString } from '../../lib/route/query'
import type { TickString } from '../../lib/time/tick'

export type WorkflowJobStatus = 'pending' | 'running' | 'completed' | 'failed'
export type WorkflowIntentStatus = 'pending' | 'dispatching' | 'completed' | 'failed' | 'dropped'
export type WorkflowDecisionStage = 'preview_only' | 'queued' | 'running' | 'failed' | 'completed'
export type WorkflowDispatchStage = 'not_requested' | 'pending' | 'dispatching' | 'completed' | 'failed' | 'dropped'
export type WorkflowState =
  | 'preview_only'
  | 'decision_pending'
  | 'decision_running'
  | 'decision_failed'
  | 'dispatch_pending'
  | 'dispatching'
  | 'workflow_completed'
  | 'workflow_dropped'
  | 'workflow_failed'

export interface WorkflowOutcomeSummary {
  kind: string
  message: string
}

export interface WorkflowJobListItem {
  id: string
  source_inference_id: string | null
  action_intent_id: string | null
  job_type: string
  status: WorkflowJobStatus
  attempt_count: number
  max_attempts: number
  idempotency_key: string | null
  last_error: string | null
  last_error_code: string | null
  last_error_stage: string | null
  created_at: TickString
  updated_at: TickString
  completed_at: TickString | null
  started_at: TickString | null
  next_retry_at: TickString | null
  strategy: string | null
  actor_ref: Record<string, unknown> | null
  target_ref: Record<string, unknown> | null
  request_input: Record<string, unknown> | null
  workflow: {
    intent_type: string | null
    intent_status: WorkflowIntentStatus | null
    decision_stage: WorkflowDecisionStage
    dispatch_stage: WorkflowDispatchStage
    workflow_state: WorkflowState
    failure_stage: string | null
    failure_code: string | null
    failure_reason: string | null
    outcome_summary: WorkflowOutcomeSummary
  }
}

export interface WorkflowJobsSnapshot {
  items: WorkflowJobListItem[]
  page_info: {
    has_next_page: boolean
    next_cursor: string | null
  }
  summary: {
    returned: number
    limit: number
    counts_by_status: Record<WorkflowJobStatus, number>
    filters: {
      status: WorkflowJobStatus[] | null
      agent_id: string | null
      identity_id: string | null
      strategy: string | null
      job_type: string | null
      from_created_at: TickString | null
      to_created_at: TickString | null
      from_tick: TickString | null
      to_tick: TickString | null
      has_error: boolean | null
      action_intent_id: string | null
      cursor: string | null
    }
  }
}

export interface WorkflowJobDetail {
  id: string
  source_inference_id: string | null
  action_intent_id: string | null
  job_type: string
  status: WorkflowJobStatus
  attempt_count: number
  max_attempts: number
  intent_class?: string | null
  request_input?: Record<string, unknown> | null
  last_error: string | null
  last_error_code?: string | null
  last_error_stage?: string | null
  idempotency_key: string | null
  started_at?: TickString | null
  next_retry_at?: TickString | null
  locked_by?: string | null
  locked_at?: TickString | null
  lock_expires_at?: TickString | null
  replay_of_job_id?: string | null
  replay_source_trace_id?: string | null
  replay_reason?: string | null
  replay_override_snapshot?: Record<string, unknown> | null
  created_at: TickString
  updated_at: TickString
  completed_at: TickString | null
}

export interface WorkflowTraceDetail {
  id: string
  kind: string
  strategy: string
  provider: string
  actor_ref: Record<string, unknown>
  input: Record<string, unknown>
  context_snapshot: Record<string, unknown>
  prompt_bundle: Record<string, unknown>
  trace_metadata: Record<string, unknown>
  decision?: Record<string, unknown> | null
  created_at: TickString
  updated_at: TickString
}

export interface WorkflowIntentDetail {
  id: string
  source_inference_id: string
  intent_type: string
  actor_ref: Record<string, unknown>
  target_ref: Record<string, unknown> | null
  payload: Record<string, unknown>
  scheduled_after_ticks: TickString | null
  scheduled_for_tick: TickString | null
  transmission_delay_ticks?: TickString | null
  transmission_policy: string
  transmission_drop_chance: number
  drop_reason?: string | null
  dispatch_error_code?: string | null
  dispatch_error_message?: string | null
  status: WorkflowIntentStatus
  locked_by?: string | null
  locked_at?: TickString | null
  lock_expires_at?: TickString | null
  dispatch_started_at?: TickString | null
  dispatched_at?: TickString | null
  created_at: TickString
  updated_at: TickString
}

export interface WorkflowSnapshotDetail {
  records: {
    trace: WorkflowTraceDetail | null
    job: WorkflowJobDetail | null
    intent: WorkflowIntentDetail | null
  }
  derived: {
    decision_stage: WorkflowDecisionStage
    dispatch_stage: WorkflowDispatchStage
    workflow_state: WorkflowState
    failure_stage: string | null
    failure_code: string | null
    failure_reason: string | null
    outcome_summary: WorkflowOutcomeSummary
  }
}

export interface RetryWorkflowJobResult {
  replayed: false
  inference_id: string
  job: WorkflowJobDetail
  result: Record<string, unknown> | null
  result_source: string
  workflow_snapshot: WorkflowSnapshotDetail
}

export interface WorkflowJobsQueryInput {
  status?: string | null
  agentId?: string | null
  strategy?: string | null
  jobType?: string | null
  cursor?: string | null
  limit?: number
  hasError?: boolean | null
  actionIntentId?: string | null
}

const buildQueryString = (input: WorkflowJobsQueryInput): string => {
  const searchParams = new URLSearchParams()

  const status = normalizeOptionalString(input.status)
  const agentId = normalizeOptionalString(input.agentId)
  const strategy = normalizeOptionalString(input.strategy)
  const jobType = normalizeOptionalString(input.jobType)
  const cursor = normalizeOptionalString(input.cursor)
  const actionIntentId = normalizeOptionalString(input.actionIntentId)

  if (status) searchParams.set('status', status)
  if (agentId) searchParams.set('agent_id', agentId)
  if (strategy) searchParams.set('strategy', strategy)
  if (jobType) searchParams.set('job_type', jobType)
  if (cursor) searchParams.set('cursor', cursor)
  if (actionIntentId) searchParams.set('action_intent_id', actionIntentId)
  if (typeof input.limit === 'number' && Number.isFinite(input.limit)) {
    searchParams.set('limit', String(Math.max(1, Math.trunc(input.limit))))
  }
  if (typeof input.hasError === 'boolean') {
    searchParams.set('has_error', input.hasError ? 'true' : 'false')
  }

  const queryString = searchParams.toString()
  return queryString.length > 0 ? `?${queryString}` : ''
}

export const useWorkflowApi = () => {
  return {
    listJobs: (input: WorkflowJobsQueryInput = {}) =>
      requestApiData<WorkflowJobsSnapshot>(`/api/inference/jobs${buildQueryString(input)}`),
    getJob: (jobId: string) => requestApiData<WorkflowJobDetail>(`/api/inference/jobs/${jobId}`),
    getJobWorkflow: (jobId: string) =>
      requestApiData<WorkflowSnapshotDetail>(`/api/inference/jobs/${jobId}/workflow`),
    getTrace: (traceId: string) => requestApiData<WorkflowTraceDetail>(`/api/inference/traces/${traceId}`),
    getIntent: (traceId: string) =>
      requestApiData<WorkflowIntentDetail>(`/api/inference/traces/${traceId}/intent`),
    getTraceWorkflow: (traceId: string) =>
      requestApiData<WorkflowSnapshotDetail>(`/api/inference/traces/${traceId}/workflow`),
    retryJob: (jobId: string) =>
      requestApiData<RetryWorkflowJobResult>(`/api/inference/jobs/${jobId}/retry`, {
        method: 'POST'
      })
  }
}
