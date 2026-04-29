import type {
  InferenceJobReplaySubmitResult,
  InferenceJobResultSource,
  InferenceJobRetryResult,
  InferenceJobSubmitResult,
  InferenceRunResult,
  WorkflowSnapshot
} from '../../../inference/types.js';
import { buildInferenceRunResultFromTrace, toInferenceJobSnapshot } from './snapshots.js';
import type { DecisionJobRecord } from './types.js';
import { resolveDecisionJobInferenceId } from './types.js';

export const resolveInferenceIdForSubmitResult = (
  workflowSnapshot: WorkflowSnapshot,
  job: DecisionJobRecord
): string => {
  return (
    workflowSnapshot.records.trace?.id ??
    workflowSnapshot.records.job?.source_inference_id ??
    resolveDecisionJobInferenceId(job)
  );
};

export const resolveResultSource = (
  replayed: boolean,
  result: InferenceRunResult | null
): InferenceJobResultSource => {
  if (!result) {
    return 'not_available';
  }

  return replayed ? 'stored_trace' : 'fresh_run';
};

export const getDecisionResultFromWorkflowSnapshot = (workflowSnapshot: WorkflowSnapshot): InferenceRunResult | null => {
  const trace = workflowSnapshot.records.trace;
  if (!trace?.decision || !trace.trace_metadata) {
    return null;
  }

  return buildInferenceRunResultFromTrace({
    id: trace.id,
    strategy: trace.strategy,
    provider: trace.provider,
    actor_ref: trace.actor_ref,
    trace_metadata: trace.trace_metadata,
    decision: trace.decision
  });
};

export const buildInferenceJobReplayResult = (
  job: DecisionJobRecord,
  workflowSnapshot: WorkflowSnapshot
): Promise<InferenceJobSubmitResult> => {
  const result = getDecisionResultFromWorkflowSnapshot(workflowSnapshot);

  return Promise.resolve({
    replayed: true,
    inference_id: resolveInferenceIdForSubmitResult(workflowSnapshot, job),
    job: toInferenceJobSnapshot(job),
    result,
    result_source: resolveResultSource(true, result),
    workflow_snapshot: workflowSnapshot
  });
};

export const buildInferenceJobSubmitResult = (
  job: DecisionJobRecord,
  result: InferenceRunResult | null,
  workflowSnapshot: WorkflowSnapshot,
  replayed: boolean
): InferenceJobSubmitResult => {
  return {
    replayed,
    inference_id: result?.inference_id ?? resolveInferenceIdForSubmitResult(workflowSnapshot, job),
    job: toInferenceJobSnapshot(job),
    result: replayed ? null : result,
    result_source: resolveResultSource(replayed, replayed ? null : result),
    workflow_snapshot: workflowSnapshot
  };
};

export const buildInferenceJobRetryResult = (
  job: DecisionJobRecord,
  result: InferenceRunResult,
  workflowSnapshot: WorkflowSnapshot
): InferenceJobRetryResult => {
  return {
    replayed: false,
    inference_id: result.inference_id,
    job: toInferenceJobSnapshot(job),
    result,
    result_source: resolveResultSource(false, result),
    workflow_snapshot: workflowSnapshot
  };
};

export const buildInferenceJobReplaySubmitResult = (
  job: DecisionJobRecord,
  workflowSnapshot: WorkflowSnapshot
): InferenceJobReplaySubmitResult => {
  return {
    replayed: false,
    inference_id: resolveInferenceIdForSubmitResult(workflowSnapshot, job),
    job: toInferenceJobSnapshot(job),
    result: null,
    result_source: 'not_available',
    workflow_snapshot: workflowSnapshot,
    replay: {
      source_job_id: job.replay_of_job_id ?? '',
      source_trace_id: job.replay_source_trace_id,
      reason: job.replay_reason,
      override_applied: Boolean(workflowSnapshot.lineage.override_applied),
      override_snapshot: workflowSnapshot.lineage.override_snapshot,
      parent_job: workflowSnapshot.lineage.parent_job,
      child_jobs: workflowSnapshot.lineage.child_jobs
    }
  };
};
