import type {
  InferenceActionIntentStatus,
  InferenceJobIntentClass,
  InferenceJobStatus,
  InferenceRequestInput
} from '../../../inference/types.js';

export interface DecisionJobRecord {
  id: string;
  locked_by: string | null;
  locked_at: bigint | null;
  lock_expires_at: bigint | null;
  replay_of_job_id: string | null;
  replay_source_trace_id: string | null;
  replay_reason: string | null;
  replay_override_snapshot: unknown;
  source_inference_id: string | null;
  pending_source_key: string | null;
  action_intent_id: string | null;
  job_type: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  request_input: unknown;
  last_error: string | null;
  last_error_code: string | null;
  last_error_stage: string | null;
  idempotency_key: string | null;
  started_at: bigint | null;
  next_retry_at: bigint | null;
  intent_class: string;
  scheduled_for_tick: bigint | null;
  created_at: bigint;
  updated_at: bigint;
  completed_at: bigint | null;
}

export interface InferenceTraceRecord {
  id: string;
  kind: string;
  strategy: string;
  provider: string;
  actor_ref: unknown;
  input: unknown;
  context_snapshot: unknown;
  prompt_bundle: unknown;
  trace_metadata: unknown;
  decision: unknown;
  created_at: bigint;
  updated_at: bigint;
}

export interface AiInvocationRecord {
  id: string;
  task_id: string;
  task_type: string;
  source_inference_id: string | null;
  provider: string;
  model: string;
  route_id: string | null;
  status: string;
  finish_reason: string;
  attempted_models_json: unknown;
  fallback_used: boolean;
  latency_ms: number | null;
  usage_json: unknown;
  safety_json: unknown;
  request_json: unknown;
  response_json: unknown;
  error_code: string | null;
  error_message: string | null;
  error_stage: string | null;
  audit_level: string;
  created_at: bigint;
  completed_at: bigint | null;
}

export interface ActionIntentRecord {
  id: string;
  source_inference_id: string;
  intent_type: string;
  actor_ref: unknown;
  target_ref: unknown;
  payload: unknown;
  scheduled_after_ticks: bigint | null;
  scheduled_for_tick: bigint | null;
  status: string;
  dispatch_started_at: bigint | null;
  dispatched_at: bigint | null;
  transmission_delay_ticks: bigint | null;
  transmission_policy: string;
  transmission_drop_chance: number;
  drop_reason: string | null;
  dispatch_error_code: string | null;
  dispatch_error_message: string | null;
  created_at: bigint;
  updated_at: bigint;
}

export interface InferenceJobsListCursor {
  created_at: string;
  id: string;
}

export interface ParsedInferenceJobsFilters {
  status: InferenceJobStatus[] | null;
  agent_id: string | null;
  identity_id: string | null;
  strategy: string | null;
  job_type: string | null;
  from_created_at: bigint | null;
  to_created_at: bigint | null;
  cursor: InferenceJobsListCursor | null;
  limit: number;
  has_error: boolean | null;
  action_intent_id: string | null;
}

export const RUNNABLE_JOB_STATUSES = ['pending', 'running'] as const;
export const INFERENCE_JOB_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;
export const ACTION_INTENT_STATUSES = ['pending', 'dispatching', 'completed', 'failed', 'dropped'] as const;
export const DEFAULT_DECISION_JOB_LOCK_TICKS = 5n;
export const DEFAULT_INFERENCE_JOB_LIST_LIMIT = 20;
export const MAX_INFERENCE_JOB_LIST_LIMIT = 100;

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

export const toRecord = (value: unknown): Record<string, unknown> => {
  return isRecord(value) ? value : {};
};

export const toTickString = (value: bigint | null): string | null => {
  return value === null ? null : value.toString();
};

export const normalizeJobStatus = (status: string): InferenceJobStatus => {
  return (INFERENCE_JOB_STATUSES as readonly string[]).includes(status) ? (status as InferenceJobStatus) : 'failed';
};

export const normalizeJobIntentClass = (intentClass: string): InferenceJobIntentClass => {
  return [
    'direct_inference',
    'scheduler_periodic',
    'scheduler_event_followup',
    'replay_recovery',
    'retry_recovery',
    'operator_forced'
  ].includes(intentClass)
    ? (intentClass as InferenceJobIntentClass)
    : 'direct_inference';
};

export const normalizeIntentStatus = (status: string): InferenceActionIntentStatus => {
  return (ACTION_INTENT_STATUSES as readonly string[]).includes(status)
    ? (status as InferenceActionIntentStatus)
    : 'failed';
};

export type { InferenceRequestInput };

export const buildPendingSourceKey = (idempotencyKey: string | null | undefined): string | null => {
  if (typeof idempotencyKey !== 'string') {
    return null;
  }

  const trimmed = idempotencyKey.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const hasMaterializedInferenceTrace = (job: Pick<DecisionJobRecord, 'source_inference_id' | 'pending_source_key'>): boolean => {
  return typeof job.source_inference_id === 'string' && job.source_inference_id.length > 0 && job.pending_source_key === null;
};

export const resolveDecisionJobInferenceId = (job: Pick<DecisionJobRecord, 'source_inference_id' | 'pending_source_key' | 'id'>): string => {
  return job.source_inference_id ?? job.pending_source_key ?? job.id;
};
