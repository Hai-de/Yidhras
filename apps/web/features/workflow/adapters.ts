import type {
  WorkflowIntentDetail,
  WorkflowJobDetail,
  WorkflowJobStatus,
  WorkflowState,
  WorkflowTraceDetail
} from '../../composables/api/useWorkflowApi'

export type WorkflowTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export interface WorkflowKeyValueField {
  label: string
  value: string
}

export interface WorkflowEntityLinkViewModel {
  id: string
  label: string
  value: string
  kind: 'agent' | 'workflow' | 'trace' | 'intent'
}

export interface WorkflowSchedulerSourceViewModel {
  sourcePage: string
  sourceLabel: string
  schedulerRunId: string | null
  schedulerDecisionId: string | null
  schedulerAgentId: string | null
  jobIntentClass: string | null
  jobSource: string | null
  schedulerReason: string | null
  schedulerKind: string | null
  schedulerScheduledForTick: string | null
}

const stringifyUnknown = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '—'
  }

  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value)
}

const resolveAgentName = (value: unknown): string => {
  if (!value || typeof value !== 'object') {
    return 'Unknown agent'
  }

  const record = value as Record<string, unknown>
  if (typeof record.name === 'string' && record.name.trim().length > 0) {
    return record.name
  }

  if (typeof record.id === 'string' && record.id.trim().length > 0) {
    return record.id
  }

  return 'Unknown agent'
}

const extractAgentId = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && record.id.trim().length > 0 ? record.id : null
}

const extractRequestInputAttributes = (job: WorkflowJobDetail | null): Record<string, unknown> | null => {
  if (!job?.request_input || typeof job.request_input !== 'object' || Array.isArray(job.request_input)) {
    return null
  }

  const requestInput = job.request_input as Record<string, unknown>
  const attributes = requestInput.attributes
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return null
  }

  return attributes as Record<string, unknown>
}

const toOptionalString = (value: unknown): string | null => {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export const resolveJobStatusTone = (status: WorkflowJobStatus): WorkflowTone => {
  switch (status) {
    case 'completed':
      return 'success'
    case 'running':
      return 'info'
    case 'failed':
      return 'danger'
    case 'pending':
    default:
      return 'warning'
  }
}

export const resolveWorkflowStateTone = (workflowState: WorkflowState): WorkflowTone => {
  switch (workflowState) {
    case 'workflow_completed':
      return 'success'
    case 'decision_running':
    case 'dispatching':
      return 'info'
    case 'workflow_failed':
    case 'decision_failed':
      return 'danger'
    case 'workflow_dropped':
    case 'dispatch_pending':
    case 'decision_pending':
      return 'warning'
    default:
      return 'neutral'
  }
}

export const stringifyDebugValue = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '—'
  }

  return JSON.stringify(value, null, 2)
}

export const buildWorkflowJobSummaryFields = (job: WorkflowJobDetail): WorkflowKeyValueField[] => {
  return [
    { label: 'job_id', value: job.id },
    { label: 'job_type', value: job.job_type },
    { label: 'attempts', value: `${job.attempt_count} / ${job.max_attempts}` },
    { label: 'intent_class', value: job.intent_class ?? '—' },
    { label: 'created_at', value: job.created_at },
    { label: 'updated_at', value: job.updated_at },
    { label: 'completed_at', value: job.completed_at ?? '—' },
    { label: 'last_error_code', value: job.last_error_code ?? '—' },
    { label: 'last_error_stage', value: job.last_error_stage ?? '—' }
  ]
}

export const buildWorkflowTraceSummaryFields = (trace: WorkflowTraceDetail): WorkflowKeyValueField[] => {
  return [
    { label: 'trace_id', value: trace.id },
    { label: 'kind', value: trace.kind },
    { label: 'strategy', value: trace.strategy },
    { label: 'provider', value: trace.provider },
    { label: 'created_at', value: trace.created_at },
    { label: 'updated_at', value: trace.updated_at }
  ]
}

export const buildWorkflowIntentSummaryFields = (intent: WorkflowIntentDetail): WorkflowKeyValueField[] => {
  return [
    { label: 'intent_id', value: intent.id },
    { label: 'intent_type', value: intent.intent_type },
    { label: 'status', value: intent.status },
    { label: 'scheduled_for', value: intent.scheduled_for_tick ?? '—' },
    { label: 'dispatched_at', value: intent.dispatched_at ?? '—' },
    { label: 'drop_reason', value: intent.drop_reason ?? '—' }
  ]
}

export const buildWorkflowEntityLinks = (input: {
  job: WorkflowJobDetail | null
  trace: WorkflowTraceDetail | null
  intent: WorkflowIntentDetail | null
}): WorkflowEntityLinkViewModel[] => {
  const links: WorkflowEntityLinkViewModel[] = []

  if (input.job?.source_inference_id && !input.job.source_inference_id.startsWith('pending_')) {
    links.push({
      id: `trace:${input.job.source_inference_id}`,
      label: 'Open trace',
      value: input.job.source_inference_id,
      kind: 'trace'
    })
  }

  if (input.job?.action_intent_id) {
    links.push({
      id: `intent:${input.job.action_intent_id}`,
      label: 'Open workflow intent',
      value: input.job.action_intent_id,
      kind: 'workflow'
    })
  }

  if (input.intent) {
    links.push({
      id: `intent-detail:${input.intent.id}`,
      label: 'Intent record',
      value: input.intent.id,
      kind: 'intent'
    })
  }

  const actorCandidate = input.intent?.actor_ref ?? input.trace?.actor_ref ?? null
  const actorId = extractAgentId(actorCandidate)
  if (actorId) {
    links.push({
      id: `actor:${actorId}`,
      label: `Open actor · ${resolveAgentName(actorCandidate)}`,
      value: actorId,
      kind: 'agent'
    })
  }

  const targetCandidate = input.intent?.target_ref ?? null
  const targetId = extractAgentId(targetCandidate)
  if (targetId) {
    links.push({
      id: `target:${targetId}`,
      label: `Open target · ${resolveAgentName(targetCandidate)}`,
      value: targetId,
      kind: 'agent'
    })
  }

  return links
}

export const buildWorkflowFailureSummary = (input: {
  job: WorkflowJobDetail | null
  workflowFailureCode: string | null
  workflowFailureReason: string | null
}): WorkflowKeyValueField[] => {
  return [
    { label: 'job_error', value: input.job?.last_error ?? '—' },
    { label: 'workflow_failure_code', value: input.workflowFailureCode ?? '—' },
    { label: 'workflow_failure_reason', value: input.workflowFailureReason ?? '—' },
    { label: 'next_retry_at', value: input.job?.next_retry_at ?? '—' }
  ]
}

export const buildWorkflowSchedulerSourceViewModel = (input: {
  sourcePage: string | null
  sourceSummary: string | null
  sourceRunId: string | null
  sourceDecisionId: string | null
  sourceAgentId: string | null
  selectedJob: WorkflowJobDetail | null
}): WorkflowSchedulerSourceViewModel | null => {
  const attributes = extractRequestInputAttributes(input.selectedJob)

  const jobIntentClass = input.selectedJob?.intent_class ?? null
  const jobSource = toOptionalString(attributes?.job_source)
  const schedulerReason = toOptionalString(attributes?.scheduler_reason)
  const schedulerKind = toOptionalString(attributes?.scheduler_kind)
  const schedulerScheduledForTick = toOptionalString(attributes?.scheduler_scheduled_for_tick)

  if (
    !input.sourcePage &&
    !input.sourceRunId &&
    !input.sourceDecisionId &&
    !input.sourceAgentId &&
    !jobIntentClass &&
    !jobSource &&
    !schedulerReason &&
    !schedulerKind &&
    !schedulerScheduledForTick
  ) {
    return null
  }

  return {
    sourcePage: input.sourcePage ?? 'unknown',
    sourceLabel: input.sourceSummary ?? 'Opened from workflow context',
    schedulerRunId: input.sourceRunId,
    schedulerDecisionId: input.sourceDecisionId,
    schedulerAgentId: input.sourceAgentId,
    jobIntentClass,
    jobSource,
    schedulerReason,
    schedulerKind,
    schedulerScheduledForTick
  }
}

export const toWorkflowRefField = (label: string, value: unknown): WorkflowKeyValueField => {
  return {
    label,
    value: stringifyUnknown(value)
  }
}
