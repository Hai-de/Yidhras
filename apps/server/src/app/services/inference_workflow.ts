import type { InferenceJobSubmitResult, InferenceRequestInput } from '../../inference/types.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import {
  getAiInvocationById,
  listAiInvocations
} from './inference_workflow/ai_invocations.js';
import {
  normalizeReplayInput,
  normalizeStoredRequestInput
} from './inference_workflow/parsers.js';
import {
  assertDecisionJobLockOwnership,
  claimDecisionJob,
  createPendingDecisionJob,
  createReplayDecisionJob,
  DEFAULT_DECISION_JOB_LOCK_TICKS,
  getActionIntentByInferenceId,
  getDecisionJobById,
  getDecisionJobByIdempotencyKey,
  getDecisionJobByInferenceId,
  getInferenceTraceById,
  getLatestSchedulerSignalTick,
  listActiveSchedulerAgents,
  listPendingSchedulerActionIntents,
  listPendingSchedulerDecisionJobs,
  listRecentEventFollowupSignals,
  listRecentRecoveryWindowActors,
  listRecentRelationshipFollowupSignals,
  listRecentScheduledDecisionJobs,
  listRecentSnrFollowupSignals,
  listRunnableDecisionJobs,
  releaseDecisionJobLock,
  updateDecisionJobState
} from './inference_workflow/repository.js';
import {
  buildInferenceJobReplayResult as buildInferenceJobReplayResultFromSnapshot,
  buildInferenceJobReplaySubmitResult,
  buildInferenceJobRetryResult,
  buildInferenceJobSubmitResult,
  getDecisionResultFromWorkflowSnapshot
} from './inference_workflow/results.js';
import {
  buildInferenceRunResultFromTrace,
  toInferenceJobSnapshot
} from './inference_workflow/snapshots.js';
import type { DecisionJobRecord } from './inference_workflow/types.js';
import { resolveDecisionJobInferenceId } from './inference_workflow/types.js';
import {
  getWorkflowSnapshotByInferenceId,
  getWorkflowSnapshotByJobId,
  listInferenceJobs
} from './inference_workflow/workflow_query.js';

export type {
  InferenceJobListItem,
  InferenceJobsListSnapshot
} from './inference_workflow/workflow_query.js';

export const getDecisionJobRequestInput = (job: DecisionJobRecord): InferenceRequestInput => {
  return normalizeStoredRequestInput(job.request_input);
};

export const buildReplayRequestInputFromJob = (job: DecisionJobRecord): InferenceRequestInput => {
  return getDecisionJobRequestInput(job);
};

export const assertDecisionJobRetryable = (job: DecisionJobRecord): void => {
  if (job.status !== 'failed') {
    throw new ApiError(409, 'DECISION_JOB_RETRY_INVALID', 'Only failed jobs can be retried', {
      job_id: job.id,
      status: job.status
    });
  }

  if (job.attempt_count >= job.max_attempts) {
    throw new ApiError(409, 'DECISION_JOB_RETRY_EXHAUSTED', 'Decision job has exhausted max attempts', {
      job_id: job.id,
      attempt_count: job.attempt_count,
      max_attempts: job.max_attempts
    });
  }
};

export const buildInferenceJobReplayResult = async (
  context: AppContext,
  idempotencyKey: string
): Promise<InferenceJobSubmitResult> => {
  const job = await getDecisionJobByIdempotencyKey(context, idempotencyKey);
  if (!job) {
    throw new ApiError(404, 'DECISION_JOB_NOT_FOUND', 'Decision job not found for idempotency key', {
      idempotency_key: idempotencyKey
    });
  }

  const workflowSnapshot = await getWorkflowSnapshotByJobId(context, job.id);
  return buildInferenceJobReplayResultFromSnapshot(job, workflowSnapshot);
};

export const normalizeReplayJobInput = normalizeReplayInput;

export {
  assertDecisionJobLockOwnership,
  buildInferenceJobReplaySubmitResult,
  buildInferenceJobRetryResult,
  buildInferenceJobSubmitResult,
  buildInferenceRunResultFromTrace,
  claimDecisionJob,
  createPendingDecisionJob,
  createReplayDecisionJob,
  DEFAULT_DECISION_JOB_LOCK_TICKS,
  getActionIntentByInferenceId,
  getAiInvocationById,
  getDecisionJobById,
  getDecisionJobByIdempotencyKey,
  getDecisionJobByInferenceId,
  getDecisionResultFromWorkflowSnapshot,
  getInferenceTraceById,
  getLatestSchedulerSignalTick,
  getWorkflowSnapshotByInferenceId,
  getWorkflowSnapshotByJobId,
  listActiveSchedulerAgents,
  listAiInvocations,
  listInferenceJobs,
  listPendingSchedulerActionIntents,
  listPendingSchedulerDecisionJobs,
  listRecentEventFollowupSignals,
  listRecentRecoveryWindowActors,
  listRecentRelationshipFollowupSignals,
  listRecentScheduledDecisionJobs,
  listRecentSnrFollowupSignals,
  listRunnableDecisionJobs,
  normalizeReplayInput,
  releaseDecisionJobLock,
  resolveDecisionJobInferenceId,
  toInferenceJobSnapshot,
  updateDecisionJobState
};
