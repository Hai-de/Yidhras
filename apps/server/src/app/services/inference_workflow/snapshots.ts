import type {
  InferenceActionIntentSnapshot,
  InferenceRunResult,
  InferenceTraceRecordSnapshot,
  WorkflowDecisionJobSnapshot,
  WorkflowDispatchStage,
  WorkflowFailureStage,
  WorkflowOutcomeSummary,
  WorkflowSnapshot,
  WorkflowState
} from '../../../inference/types.js';
import { toJsonSafe } from '../../http/json.js';
import type { ActionIntentRecord, DecisionJobRecord, InferenceTraceRecord } from './types.js';
import {
  isRecord,
  normalizeIntentStatus,
  normalizeJobIntentClass,
  normalizeJobStatus,
  resolveDecisionJobInferenceId,
  toRecord,
  toTickString
} from './types.js';

const toReplayLineageParentSnapshot = (job: DecisionJobRecord | null) => {
  if (!job) {
    return null;
  }

  return {
    id: job.id,
    status: normalizeJobStatus(job.status),
    created_at: job.created_at.toString(),
    completed_at: toTickString(job.completed_at)
  };
};

const toReplayLineageChildSnapshots = (jobs: DecisionJobRecord[]) => {
  return jobs.map(job => ({
    id: job.id,
    status: normalizeJobStatus(job.status),
    created_at: job.created_at.toString(),
    replay_reason: job.replay_reason
  }));
};

export const toInferenceJobSnapshot = (job: DecisionJobRecord) => {
  return {
    id: job.id,
    source_inference_id: resolveDecisionJobInferenceId(job),
    action_intent_id: job.action_intent_id,
    job_type: job.job_type,
    status: normalizeJobStatus(job.status),
    pending_source_key: job.pending_source_key,
    attempt_count: job.attempt_count,
    max_attempts: job.max_attempts,
    last_error: job.last_error,
    idempotency_key: job.idempotency_key,
    created_at: job.created_at.toString(),
    intent_class: normalizeJobIntentClass(job.intent_class),
    updated_at: job.updated_at.toString(),
    completed_at: toTickString(job.completed_at)
  };
};

export const toWorkflowDecisionJobSnapshot = (job: DecisionJobRecord): WorkflowDecisionJobSnapshot => {
  return {
    ...toInferenceJobSnapshot(job),
    last_error: job.last_error,
    idempotency_key: job.idempotency_key,
    request_input: isRecord(job.request_input) ? toRecord(toJsonSafe(job.request_input)) : null,
    started_at: toTickString(job.started_at),
    next_retry_at: toTickString(job.next_retry_at),
    scheduled_for_tick: toTickString(job.scheduled_for_tick),
    replay_of_job_id: job.replay_of_job_id,
    replay_source_trace_id: job.replay_source_trace_id,
    replay_reason: job.replay_reason,
    replay_override_snapshot: isRecord(job.replay_override_snapshot) ? toRecord(toJsonSafe(job.replay_override_snapshot)) : null,
    last_error_code: (job.last_error_code as WorkflowDecisionJobSnapshot['last_error_code']) ?? null,
    locked_by: job.locked_by,
    locked_at: toTickString(job.locked_at),
    lock_expires_at: toTickString(job.lock_expires_at),
    last_error_stage: (job.last_error_stage as WorkflowDecisionJobSnapshot['last_error_stage']) ?? null
  };
};

export const toInferenceTraceRecordSnapshot = (
  trace: InferenceTraceRecord | null
): InferenceTraceRecordSnapshot | null => {
  if (!trace) {
    return null;
  }

  return {
    id: trace.id,
    kind: trace.kind,
    strategy: trace.strategy,
    provider: trace.provider,
    actor_ref: toRecord(toJsonSafe(trace.actor_ref)),
    input: toRecord(toJsonSafe(trace.input)),
    context_snapshot: (() => {
      const snapshot = toRecord(toJsonSafe(trace.context_snapshot));

      const contextModule = isRecord(snapshot.context_module) ? toRecord(snapshot.context_module) : null;
      if (contextModule) {
        contextModule.policy_decisions = Array.isArray(contextModule.policy_decisions) ? contextModule.policy_decisions : [];
        contextModule.blocked_nodes = Array.isArray(contextModule.blocked_nodes) ? contextModule.blocked_nodes : [];
        contextModule.locked_nodes = Array.isArray(contextModule.locked_nodes) ? contextModule.locked_nodes : [];
        contextModule.visibility_denials = Array.isArray(contextModule.visibility_denials) ? contextModule.visibility_denials : [];
        contextModule.overlay_nodes_loaded = Array.isArray(contextModule.overlay_nodes_loaded) ? contextModule.overlay_nodes_loaded : [];
        contextModule.overlay_nodes_mutated = Array.isArray(contextModule.overlay_nodes_mutated) ? contextModule.overlay_nodes_mutated : [];
        contextModule.submitted_directives = Array.isArray(contextModule.submitted_directives) ? contextModule.submitted_directives : [];
        contextModule.approved_directives = Array.isArray(contextModule.approved_directives) ? contextModule.approved_directives : [];
        contextModule.denied_directives = Array.isArray(contextModule.denied_directives) ? contextModule.denied_directives : [];
        snapshot.context_module = contextModule;
      }

      const contextDebug = isRecord(snapshot.context_debug) ? toRecord(snapshot.context_debug) : null;
      if (contextDebug) {
        contextDebug.policy_decisions = Array.isArray(contextDebug.policy_decisions) ? contextDebug.policy_decisions : [];
        contextDebug.blocked_nodes = Array.isArray(contextDebug.blocked_nodes) ? contextDebug.blocked_nodes : [];
        contextDebug.locked_nodes = Array.isArray(contextDebug.locked_nodes) ? contextDebug.locked_nodes : [];
        contextDebug.visibility_denials = Array.isArray(contextDebug.visibility_denials) ? contextDebug.visibility_denials : [];
        contextDebug.overlay_nodes_loaded = Array.isArray(contextDebug.overlay_nodes_loaded) ? contextDebug.overlay_nodes_loaded : [];
        contextDebug.overlay_nodes_mutated = Array.isArray(contextDebug.overlay_nodes_mutated) ? contextDebug.overlay_nodes_mutated : [];
        contextDebug.submitted_directives = Array.isArray(contextDebug.submitted_directives) ? contextDebug.submitted_directives : [];
        contextDebug.approved_directives = Array.isArray(contextDebug.approved_directives) ? contextDebug.approved_directives : [];
        contextDebug.denied_directives = Array.isArray(contextDebug.denied_directives) ? contextDebug.denied_directives : [];
        snapshot.context_debug = contextDebug;
      }

      snapshot.policy_decisions = Array.isArray(snapshot.policy_decisions) ? snapshot.policy_decisions : [];
      snapshot.blocked_nodes = Array.isArray(snapshot.blocked_nodes) ? snapshot.blocked_nodes : [];
      snapshot.locked_nodes = Array.isArray(snapshot.locked_nodes) ? snapshot.locked_nodes : [];
      snapshot.visibility_denials = Array.isArray(snapshot.visibility_denials) ? snapshot.visibility_denials : [];
      snapshot.overlay_nodes_loaded = Array.isArray(snapshot.overlay_nodes_loaded) ? snapshot.overlay_nodes_loaded : [];
      snapshot.overlay_nodes_mutated = Array.isArray(snapshot.overlay_nodes_mutated) ? snapshot.overlay_nodes_mutated : [];
      snapshot.submitted_directives = Array.isArray(snapshot.submitted_directives) ? snapshot.submitted_directives : [];
      snapshot.approved_directives = Array.isArray(snapshot.approved_directives) ? snapshot.approved_directives : [];
      snapshot.denied_directives = Array.isArray(snapshot.denied_directives) ? snapshot.denied_directives : [];
      return snapshot;
    })(),
    prompt_bundle: toRecord(toJsonSafe(trace.prompt_bundle)),
    trace_metadata: toRecord(toJsonSafe(trace.trace_metadata)),
    decision: trace.decision ? toRecord(toJsonSafe(trace.decision)) : null,
    created_at: trace.created_at.toString(),
    updated_at: trace.updated_at.toString()
  };
};

export const toInferenceActionIntentSnapshot = (
  intent: ActionIntentRecord | null
): InferenceActionIntentSnapshot | null => {
  if (!intent) {
    return null;
  }

  const transmissionPolicy =
    intent.transmission_policy === 'best_effort' ||
    intent.transmission_policy === 'fragile' ||
    intent.transmission_policy === 'blocked'
      ? intent.transmission_policy
      : 'reliable';

  return {
    id: intent.id,
    source_inference_id: intent.source_inference_id,
    intent_type: intent.intent_type,
    actor_ref: toRecord(toJsonSafe(intent.actor_ref)),
    target_ref: isRecord(toJsonSafe(intent.target_ref)) ? toRecord(toJsonSafe(intent.target_ref)) : null,
    payload: toRecord(toJsonSafe(intent.payload)),
    scheduled_after_ticks: toTickString(intent.scheduled_after_ticks),
    scheduled_for_tick: toTickString(intent.scheduled_for_tick),
    status: normalizeIntentStatus(intent.status),
    dispatch_started_at: toTickString(intent.dispatch_started_at),
    dispatched_at: toTickString(intent.dispatched_at),
    transmission_delay_ticks: toTickString(intent.transmission_delay_ticks),
    transmission_policy: transmissionPolicy,
    transmission_drop_chance: intent.transmission_drop_chance,
    drop_reason: intent.status === 'failed' ? intent.dispatch_error_message : intent.drop_reason,
    dispatch_error_code: (intent.dispatch_error_code as InferenceActionIntentSnapshot['dispatch_error_code']) ?? null,
    dispatch_error_message: intent.dispatch_error_message,
    created_at: intent.created_at.toString(),
    updated_at: intent.updated_at.toString()
  };
};

export const deriveWorkflowFailureStage = (
  job: WorkflowDecisionJobSnapshot | null,
  intent: InferenceActionIntentSnapshot | null
): { stage: WorkflowFailureStage; code: string | null; reason: string | null } => {
  if (job?.status === 'failed') {
    return {
      stage: job.last_error_stage === 'provider' || job.last_error_stage === 'normalization' || job.last_error_stage === 'persistence'
        ? job.last_error_stage
        : 'unknown',
      code: job.last_error_code ?? 'UNKNOWN_WORKFLOW_FAILURE',
      reason: job.last_error
    };
  }

  if (intent?.status === 'failed') {
    return {
      stage: 'dispatch',
      code: intent.dispatch_error_code ?? 'ACTION_DISPATCH_FAIL',
      reason: intent.dispatch_error_message ?? null
    };
  }

  return { stage: 'none', code: null, reason: intent?.status === 'dropped' ? intent.drop_reason : null };
};

export const deriveWorkflowDispatchStage = (intent: InferenceActionIntentSnapshot | null): WorkflowDispatchStage => {
  if (!intent) {
    return 'not_requested';
  }

  switch (intent.status) {
    case 'pending':
      return 'pending';
    case 'dispatching':
      return 'dispatching';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'dropped':
      return 'dropped';
    default:
      return 'failed';
  }
};

export const deriveWorkflowOutcomeSummary = (workflowState: WorkflowState): WorkflowOutcomeSummary => {
  switch (workflowState) {
    case 'preview_only':
      return { kind: 'preview_only', message: 'Preview trace exists without a persisted execution workflow' };
    case 'decision_pending':
      return { kind: 'decision_pending', message: 'Decision job is queued and has not completed yet' };
    case 'decision_running':
      return { kind: 'decision_running', message: 'Decision job is currently running' };
    case 'decision_failed':
      return { kind: 'decision_failed', message: 'Decision generation failed before dispatch could complete' };
    case 'dispatch_pending':
      return { kind: 'dispatch_pending', message: 'Decision completed and dispatch is pending' };
    case 'dispatching':
      return { kind: 'dispatching', message: 'World-side dispatch is in progress' };
    case 'workflow_completed':
      return { kind: 'completed', message: 'Workflow completed and world-side action was materialized' };
    case 'workflow_dropped':
      return { kind: 'dropped', message: 'Workflow ended in an intentional drop before world-side materialization' };
    case 'workflow_failed':
      return { kind: 'failed', message: 'Workflow failed during world-side dispatch' };
  }
};

export const buildWorkflowSnapshot = (input: {
  trace: InferenceTraceRecord | null;
  job: DecisionJobRecord | null;
  intent: ActionIntentRecord | null;
  replayParentJob?: DecisionJobRecord | null;
  replayChildJobs?: DecisionJobRecord[];
}): WorkflowSnapshot => {
  const trace = toInferenceTraceRecordSnapshot(input.trace);
  const job = input.job ? toWorkflowDecisionJobSnapshot(input.job) : null;
  const intent = toInferenceActionIntentSnapshot(input.intent);

  const decisionStage = !job
    ? trace?.kind === 'preview'
      ? 'preview_only'
      : 'queued'
    : job.status === 'pending'
      ? 'queued'
      : job.status === 'running'
        ? 'running'
        : job.status === 'failed'
          ? 'failed'
          : 'completed';

  const dispatchStage = deriveWorkflowDispatchStage(intent);
  const failure = deriveWorkflowFailureStage(job, intent);

  let workflowState: WorkflowState;
  if (decisionStage === 'preview_only') {
    workflowState = 'preview_only';
  } else if (decisionStage === 'queued') {
    workflowState = 'decision_pending';
  } else if (decisionStage === 'running') {
    workflowState = 'decision_running';
  } else if (decisionStage === 'failed') {
    workflowState = 'decision_failed';
  } else if (dispatchStage === 'not_requested' || dispatchStage === 'pending') {
    workflowState = 'dispatch_pending';
  } else if (dispatchStage === 'dispatching') {
    workflowState = 'dispatching';
  } else if (dispatchStage === 'completed') {
    workflowState = 'workflow_completed';
  } else if (dispatchStage === 'dropped') {
    workflowState = 'workflow_dropped';
  } else {
    workflowState = 'workflow_failed';
  }

  return {
    records: {
      trace,
      job,
      intent
    },
    lineage: {
      replay_of_job_id: input.job?.replay_of_job_id ?? null,
      replay_source_trace_id: input.job?.replay_source_trace_id ?? null,
      replay_reason: input.job?.replay_reason ?? null,
      override_applied: isRecord(input.job?.replay_override_snapshot),
      override_snapshot: isRecord(input.job?.replay_override_snapshot)
        ? toRecord(toJsonSafe(input.job?.replay_override_snapshot))
        : null,
      parent_job: toReplayLineageParentSnapshot(input.replayParentJob ?? null),
      child_jobs: toReplayLineageChildSnapshots(input.replayChildJobs ?? [])
    },
    derived: {
      decision_stage: decisionStage,
      dispatch_stage: dispatchStage,
      workflow_state: workflowState,
      failure_stage: failure.stage,
      failure_code: failure.code as WorkflowSnapshot['derived']['failure_code'],
      failure_reason: failure.reason,
      outcome_summary: deriveWorkflowOutcomeSummary(workflowState)
    }
  };
};

export const buildInferenceRunResultFromTrace = (trace: {
  id: string;
  strategy: string;
  provider: string;
  actor_ref: unknown;
  trace_metadata: unknown;
  decision: unknown;
} | null): InferenceRunResult | null => {
  if (!trace?.decision || !trace.trace_metadata) {
    return null;
  }

  const traceMetadata = toJsonSafe(trace.trace_metadata) as InferenceRunResult['trace_metadata'];

  return {
    inference_id: trace.id,
    actor_ref: toJsonSafe(trace.actor_ref) as InferenceRunResult['actor_ref'],
    strategy: trace.strategy as InferenceRunResult['strategy'],
    provider: trace.provider,
    tick: typeof traceMetadata.tick === 'string' ? traceMetadata.tick : '',
    decision: toJsonSafe(trace.decision) as InferenceRunResult['decision'],
    trace_metadata: traceMetadata
  };
};
