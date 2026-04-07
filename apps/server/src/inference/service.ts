import type { AppContext } from '../app/context.js';
import { toJsonSafe } from '../app/http/json.js';
import {
  assertDecisionJobLockOwnership,
  assertDecisionJobRetryable,
  buildInferenceJobReplayResult,
  buildInferenceJobReplaySubmitResult,
  buildInferenceJobRetryResult,
  buildInferenceJobSubmitResult,
  buildReplayRequestInputFromJob,
  claimDecisionJob,
  createPendingDecisionJob,
  createReplayDecisionJob,
  DEFAULT_DECISION_JOB_LOCK_TICKS,
  getDecisionJobById,
  getDecisionJobByIdempotencyKey,
  getDecisionJobRequestInput,
  getWorkflowSnapshotByJobId,
  normalizeReplayInput,
  releaseDecisionJobLock,
  updateDecisionJobState
} from '../app/services/inference_workflow.js';
import { ApiError } from '../utils/api_error.js';
import { buildInferenceContext } from './context_builder.js';
import { buildPromptBundle } from './prompt_builder.js';
import type { InferenceProvider } from './provider.js';
import { createMockInferenceProvider } from './providers/mock.js';
import { createRuleBasedInferenceProvider } from './providers/rule_based.js';
import { createNoopInferenceTraceSink } from './sinks/noop.js';
import type { InferenceTraceSink } from './trace_sink.js';
import type {
  ActionIntentDraft,
  DecisionResult,
  InferenceJobReplayInput,
  InferenceJobReplaySubmitResult,
  InferenceJobRetryResult,
  InferenceJobSubmitResult,
  InferencePreviewResult,
  InferenceRequestInput,
  InferenceRunResult,
  InferenceStrategy,
  ProviderDecisionRaw,
  TraceMetadata
} from './types.js';

export interface InferenceService {
  readonly phase: 'workflow_baseline';
  readonly ready: true;
  previewInference(input: InferenceRequestInput): Promise<InferencePreviewResult>;
  runInference(input: InferenceRequestInput): Promise<InferenceRunResult>;
  submitInferenceJob(input: InferenceRequestInput): Promise<InferenceJobSubmitResult>;
  replayInferenceJob(jobId: string, input?: InferenceJobReplayInput): Promise<InferenceJobReplaySubmitResult>;
  retryInferenceJob(jobId: string): Promise<InferenceJobRetryResult>;
  executeDecisionJob(jobId: string, options: { workerId: string }): Promise<InferenceRunResult | null>;
  buildActionIntentDraft(decision: DecisionResult, sourceInferenceId: string, actorRef: InferenceRunResult['actor_ref']): ActionIntentDraft;
}

export interface CreateInferenceServiceOptions {
  context: AppContext;
  providers?: InferenceProvider[];
  traceSink?: InferenceTraceSink;
}

const DEFAULT_JOB_MAX_ATTEMPTS = 3;
const JOB_RETRY_DELAY_TICKS = 1n;

const assertRecord = (value: unknown, code: string, message: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(500, code, message);
  }

  return value as Record<string, unknown>;
};

const normalizeConfidence = (value: unknown): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiError(500, 'INFERENCE_NORMALIZATION_FAIL', 'decision.confidence must be a finite number');
  }

  return value;
};

const normalizeDelayHintTicks = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new ApiError(500, 'INFERENCE_NORMALIZATION_FAIL', 'decision.delay_hint_ticks must be an integer string');
    }
    return trimmed;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ApiError(500, 'INFERENCE_NORMALIZATION_FAIL', 'decision.delay_hint_ticks must be a non-negative safe integer');
    }
    return String(value);
  }

  throw new ApiError(500, 'INFERENCE_NORMALIZATION_FAIL', 'decision.delay_hint_ticks must be a string or number');
};

const normalizeOptionalString = (value: unknown, fieldName: string): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new ApiError(500, 'INFERENCE_NORMALIZATION_FAIL', `${fieldName} must be a string`);
  }

  return value;
};

const normalizeTargetRef = (value: unknown): Record<string, unknown> | null => {
  if (value === undefined || value === null) {
    return null;
  }

  return assertRecord(value, 'INFERENCE_NORMALIZATION_FAIL', 'decision.target_ref must be an object or null');
};

const normalizeDecision = (raw: ProviderDecisionRaw): DecisionResult => {
  if (typeof raw.action_type !== 'string' || raw.action_type.trim().length === 0) {
    throw new ApiError(500, 'INFERENCE_NORMALIZATION_FAIL', 'decision.action_type must be a non-empty string');
  }

  return {
    action_type: raw.action_type,
    target_ref: normalizeTargetRef(raw.target_ref),
    payload: assertRecord(raw.payload ?? {}, 'INFERENCE_NORMALIZATION_FAIL', 'decision.payload must be an object'),
    confidence: normalizeConfidence(raw.confidence),
    delay_hint_ticks: normalizeDelayHintTicks(raw.delay_hint_ticks),
    reasoning: normalizeOptionalString(raw.reasoning, 'decision.reasoning'),
    meta:
      raw.meta === undefined || raw.meta === null
        ? undefined
        : assertRecord(raw.meta, 'INFERENCE_NORMALIZATION_FAIL', 'decision.meta must be an object')
  };
};

const selectProvider = (providers: InferenceProvider[], strategy: InferenceStrategy): InferenceProvider => {
  const provider = providers.find(candidate => candidate.strategies.includes(strategy));
  if (!provider) {
    throw new ApiError(500, 'INFERENCE_PROVIDER_FAIL', 'No provider is registered for the selected strategy', {
      strategy
    });
  }

  return provider;
};

const persistTraceEvent = async (
  traceSink: InferenceTraceSink,
  event: Parameters<InferenceTraceSink['record']>[0]
): Promise<void> => {
  try {
    await traceSink.record(event);
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    throw new ApiError(500, 'INFERENCE_TRACE_PERSIST_FAIL', err instanceof Error ? err.message : String(err));
  }
};

const buildTraceMetadata = (
  inferenceId: string,
  strategy: InferenceStrategy,
  providerName: string,
  tick: string,
  worldPackId: string,
  bindingRef: InferencePreviewResult['metadata']['binding_ref'],
  promptVersion: string | null
): TraceMetadata => {
  return {
    inference_id: inferenceId,
    world_pack_id: worldPackId,
    binding_ref: bindingRef,
    prompt_version: promptVersion,
    tick,
    strategy,
    provider: providerName
  };
};

const hasIdempotencyKey = (
  input: InferenceRequestInput
): input is InferenceRequestInput & { idempotency_key: string } => {
  return typeof input.idempotency_key === 'string' && input.idempotency_key.trim().length > 0;
};

const classifyFailure = (err: unknown): {
  code: string;
  stage: 'provider' | 'normalization' | 'persistence' | 'unknown';
  message: string;
} => {
  if (err instanceof ApiError) {
    const stage = err.code === 'INFERENCE_PROVIDER_FAIL'
      ? 'provider'
      : err.code === 'INFERENCE_NORMALIZATION_FAIL'
        ? 'normalization'
        : err.code === 'INFERENCE_TRACE_PERSIST_FAIL'
          ? 'persistence'
          : 'unknown';
    return { code: err.code, stage, message: err.message };
  }

  return { code: 'INFERENCE_PROVIDER_FAIL', stage: 'provider', message: err instanceof Error ? err.message : String(err) };
};

const executeRunInternal = async (
  service: InferenceService,
  traceSink: InferenceTraceSink,
  context: AppContext,
  providers: InferenceProvider[],
  input: InferenceRequestInput,
  options?: {
    jobId?: string;
    attemptCount?: number;
    maxAttempts?: number;
  }
): Promise<InferenceRunResult> => {
  const inferenceContext = await buildInferenceContext(context, input);
  const provider = selectProvider(providers, inferenceContext.strategy);
  const prompt = await buildPromptBundle(inferenceContext);
  const attemptCount = options?.attemptCount ?? 1;
  const maxAttempts = options?.maxAttempts ?? DEFAULT_JOB_MAX_ATTEMPTS;

  let rawDecision: ProviderDecisionRaw;
  try {
    rawDecision = await provider.run(inferenceContext, prompt);
  } catch (err) {
    const failure = classifyFailure(err);

    if (options?.jobId) {
      const currentTick = context.sim.getCurrentTick();
      const existingJob = await getDecisionJobById(context, options.jobId);
      const retryExhausted = existingJob.attempt_count >= existingJob.max_attempts;
      await updateDecisionJobState(context, {
        job_id: options.jobId,
        status: 'failed',
        last_error: failure.message,
        last_error_code: failure.code,
        last_error_stage: failure.stage,
        increment_attempt: false,
        next_retry_at: retryExhausted ? null : currentTick + JOB_RETRY_DELAY_TICKS,
        locked_by: null,
        locked_at: null,
        lock_expires_at: null,
        completed_at: null
      });

      if (err instanceof ApiError) {
        throw err;
      }
      throw new ApiError(500, failure.code, failure.message);
    }

    if (err instanceof ApiError) {
      throw err;
    }
    return Promise.reject(new ApiError(500, failure.code, failure.message));
  }

  let decision: DecisionResult;
  try {
    decision = normalizeDecision(rawDecision);
  } catch (err) {
    if (options?.jobId) {
      const failure = classifyFailure(err);
      const currentTick = context.sim.getCurrentTick();
      const existingJob = await getDecisionJobById(context, options.jobId);
      const retryExhausted = existingJob.attempt_count >= existingJob.max_attempts;
      await updateDecisionJobState(context, {
        job_id: options.jobId,
        status: 'failed',
        last_error: failure.message,
        last_error_code: failure.code,
        last_error_stage: failure.stage,
        increment_attempt: false,
        next_retry_at: retryExhausted ? null : currentTick + JOB_RETRY_DELAY_TICKS,
        locked_by: null,
        locked_at: null,
        lock_expires_at: null,
        completed_at: null
      });
    }
    throw err;
  }

  const actionIntentDraft = service.buildActionIntentDraft(
    decision,
    inferenceContext.inference_id,
    inferenceContext.actor_ref
  );

  const transmissionDelayTicks =
    decision.meta && typeof decision.meta.transmission_delay_ticks === 'string'
      ? decision.meta.transmission_delay_ticks
      : decision.meta && typeof decision.meta.transmission_delay_ticks === 'number'
        ? String(decision.meta.transmission_delay_ticks)
        : decision.delay_hint_ticks ?? '0';
  const transmissionDropChance =
    decision.meta && typeof decision.meta.transmission_drop_chance === 'number'
      ? decision.meta.transmission_drop_chance
      : 0;
  const transmissionPolicy =
    decision.meta && typeof decision.meta.transmission_policy === 'string'
      ? decision.meta.transmission_policy
      : 'reliable';
  const dropReason =
    decision.meta && typeof decision.meta.drop_reason === 'string'
      ? decision.meta.drop_reason
      : null;

  actionIntentDraft.transmission_delay_ticks = transmissionDelayTicks;
  actionIntentDraft.transmission_drop_chance =
    Number.isFinite(transmissionDropChance) && transmissionDropChance >= 0 && transmissionDropChance <= 1
      ? transmissionDropChance
      : 0;
  actionIntentDraft.transmission_policy =
    transmissionPolicy === 'best_effort' ||
    transmissionPolicy === 'fragile' ||
    transmissionPolicy === 'blocked'
      ? transmissionPolicy
      : 'reliable';
  actionIntentDraft.drop_reason = dropReason;

  if (actionIntentDraft.scheduled_after_ticks === null) {
    actionIntentDraft.scheduled_after_ticks = transmissionDelayTicks;
  }

  const tick = inferenceContext.tick.toString();
  const traceMetadata = buildTraceMetadata(
    inferenceContext.inference_id,
    inferenceContext.strategy,
    provider.name,
    tick,
    inferenceContext.world_pack.id,
    inferenceContext.binding_ref,
    prompt.metadata.prompt_version
  );

  await persistTraceEvent(traceSink, {
    kind: 'run',
    inference_id: inferenceContext.inference_id,
    strategy: inferenceContext.strategy,
    provider: provider.name,
    actor_ref: inferenceContext.actor_ref,
    input,
    context: inferenceContext,
    prompt,
    trace_metadata: traceMetadata,
    decision,
    action_intent_draft: actionIntentDraft,
    job_id: options?.jobId,
    job_status: 'completed',
    job_last_error: null,
    job_last_error_code: null,
    job_last_error_stage: null,
    job_attempt_count: attemptCount,
    job_max_attempts: maxAttempts
  });

  return {
    inference_id: inferenceContext.inference_id,
    actor_ref: toJsonSafe(inferenceContext.actor_ref) as InferenceRunResult['actor_ref'],
    strategy: inferenceContext.strategy,
    provider: provider.name,
    tick,
    decision: toJsonSafe(decision) as InferenceRunResult['decision'],
    trace_metadata: toJsonSafe(traceMetadata) as InferenceRunResult['trace_metadata']
  };
};

export const createInferenceService = ({
  context,
  providers = [createMockInferenceProvider(), createRuleBasedInferenceProvider()],
  traceSink = createNoopInferenceTraceSink()
}: CreateInferenceServiceOptions): InferenceService => {
  const service: InferenceService = {
    phase: 'workflow_baseline',
    ready: true,
    async previewInference(input) {
      const inferenceContext = await buildInferenceContext(context, input);
      const provider = selectProvider(providers, inferenceContext.strategy);
      const prompt = await buildPromptBundle(inferenceContext);
      const tick = inferenceContext.tick.toString();
      const metadata = {
        world_pack_id: inferenceContext.world_pack.id,
        binding_ref: inferenceContext.binding_ref,
        prompt_version: prompt.metadata.prompt_version
      };
      const traceMetadata = buildTraceMetadata(
        inferenceContext.inference_id,
        inferenceContext.strategy,
        provider.name,
        tick,
        metadata.world_pack_id,
        metadata.binding_ref,
        metadata.prompt_version
      );

      await persistTraceEvent(traceSink, {
        kind: 'preview',
        inference_id: inferenceContext.inference_id,
        strategy: inferenceContext.strategy,
        provider: provider.name,
        actor_ref: inferenceContext.actor_ref,
        input,
        context: inferenceContext,
        prompt,
        trace_metadata: traceMetadata
      });

      return {
        inference_id: inferenceContext.inference_id,
        actor_ref: toJsonSafe(inferenceContext.actor_ref) as InferencePreviewResult['actor_ref'],
        strategy: inferenceContext.strategy,
        provider: provider.name,
        tick,
        prompt: toJsonSafe(prompt) as InferencePreviewResult['prompt'],
        metadata: toJsonSafe(metadata) as InferencePreviewResult['metadata']
      };
    },
    async runInference(input) {
      return executeRunInternal(service, traceSink, context, providers, input);
    },
    async submitInferenceJob(input) {
      if (!hasIdempotencyKey(input)) {
        throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'idempotency_key is required for job submission');
      }

      const idempotencyKey = input.idempotency_key.trim();
      const normalizedInput: InferenceRequestInput = {
        ...input,
        idempotency_key: idempotencyKey
      };

      const existingJob = await getDecisionJobByIdempotencyKey(context, idempotencyKey);
      if (existingJob) {
        return buildInferenceJobReplayResult(context, idempotencyKey);
      }

      const pendingJob = await createPendingDecisionJob(context, {
        idempotency_key: idempotencyKey,
        request_input: normalizedInput,
        intent_class: 'direct_inference',
        job_source: 'api_submit',
        max_attempts: DEFAULT_JOB_MAX_ATTEMPTS
      });
      const workflowSnapshot = await getWorkflowSnapshotByJobId(context, pendingJob.id);

      return buildInferenceJobSubmitResult(pendingJob, null, workflowSnapshot, false);
    },
    async replayInferenceJob(jobId, input) {
      const sourceJob = await getDecisionJobById(context, jobId);
      const replayInput = normalizeReplayInput(input);

      if (
        typeof replayInput.overrides?.agent_id === 'string' ||
        typeof replayInput.overrides?.identity_id === 'string'
      ) {
        throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'Replay overrides cannot include agent_id or identity_id');
      }

      const requestInput = buildReplayRequestInputFromJob(sourceJob);
      const mergedInput: InferenceRequestInput = {
        ...requestInput,
        strategy: replayInput.overrides?.strategy ?? requestInput.strategy,
        attributes: {
          ...(requestInput.attributes ?? {}),
          ...(replayInput.overrides?.attributes ?? {})
        }
      };
      const idempotencyKey = replayInput.idempotency_key ?? `replay_${sourceJob.id}_${Date.now()}`;

      const replayOverrideSnapshot =
        replayInput.overrides && (replayInput.overrides.strategy !== undefined || replayInput.overrides.attributes !== undefined)
          ? {
              ...(replayInput.overrides.strategy ? { strategy: replayInput.overrides.strategy } : {}),
              ...(replayInput.overrides.attributes ? { attributes: replayInput.overrides.attributes } : {})
            }
          : null;

      const duplicateReplayJob = await getDecisionJobByIdempotencyKey(context, idempotencyKey);
      if (duplicateReplayJob) {
        throw new ApiError(409, 'INFERENCE_INPUT_INVALID', 'Replay idempotency_key already exists', {
          idempotency_key: idempotencyKey,
          job_id: duplicateReplayJob.id
        });
      }

      const replayJob = await createReplayDecisionJob(context, {
        source_job: sourceJob,
        source_trace_id: sourceJob.pending_source_key === null ? sourceJob.source_inference_id : null,
        request_input: { ...mergedInput, idempotency_key: idempotencyKey },
        idempotency_key: idempotencyKey,
        reason: replayInput.reason ?? 'operator_manual_replay',
        max_attempts: sourceJob.max_attempts,
        intent_class: 'replay_recovery',
        job_source: 'replay',
        replay_override_snapshot: replayOverrideSnapshot
      });
      const workflowSnapshot = await getWorkflowSnapshotByJobId(context, replayJob.id);

      return buildInferenceJobReplaySubmitResult(replayJob, workflowSnapshot);
    },
    async retryInferenceJob(jobId) {
      const existingJob = await getDecisionJobById(context, jobId);
      assertDecisionJobRetryable(existingJob);

      await updateDecisionJobState(context, {
        job_id: existingJob.id,
        status: 'pending',
        started_at: null,
        intent_class: 'retry_recovery',
        request_input_attributes_patch: { job_intent_class: 'retry_recovery', job_source: 'retry' },
        last_error: null,
  last_error_code: null,
        last_error_stage: null,
        next_retry_at: context.sim.getCurrentTick(),
        locked_by: null,
        locked_at: null,
        lock_expires_at: null,
        completed_at: null
      });

      const claimedJob = await claimDecisionJob(context, {
        job_id: existingJob.id,
        worker_id: `retry:${existingJob.id}`,
        lock_ticks: DEFAULT_DECISION_JOB_LOCK_TICKS
      });
      if (!claimedJob) {
        throw new ApiError(409, 'DECISION_JOB_RETRY_INVALID', 'Retry job could not be claimed');
      }

      const result = await service.executeDecisionJob(claimedJob.id, {
        workerId: `retry:${existingJob.id}`
      });
      if (!result) {
        throw new ApiError(500, 'INFERENCE_PROVIDER_FAIL', 'Retry job did not produce a result');
      }
      const completedJob = await getDecisionJobById(context, existingJob.id);
      const workflowSnapshot = await getWorkflowSnapshotByJobId(context, completedJob.id);

      return buildInferenceJobRetryResult(completedJob, result, workflowSnapshot);
    },
    async executeDecisionJob(jobId, options) {
      const job = await getDecisionJobById(context, jobId);
      const now = context.sim.getCurrentTick();

      if (job.status !== 'running') {
        return null;
      }

      try {
        assertDecisionJobLockOwnership(job, options.workerId, now);
      } catch {
        return null;
      }

      const requestInput = getDecisionJobRequestInput(job);
      try {
        const result = await executeRunInternal(service, traceSink, context, providers, requestInput, {
          jobId: job.id,
          attemptCount: job.attempt_count,
          maxAttempts: job.max_attempts
        });
        await releaseDecisionJobLock(context, {
          job_id: job.id,
          worker_id: options.workerId
        });
        return result;
      } catch (err) {
        await releaseDecisionJobLock(context, {
          job_id: job.id,
          worker_id: options.workerId
        });
        throw err;
      }
    },
    buildActionIntentDraft(decision, sourceInferenceId, actorRef) {
      return {
        intent_type: decision.action_type,
        actor_ref: actorRef,
        target_ref: decision.target_ref,
        payload: decision.payload,
        scheduled_after_ticks: decision.delay_hint_ticks ?? null,
        transmission_delay_ticks: decision.delay_hint_ticks ?? null,
        transmission_policy: 'reliable',
        transmission_drop_chance: 0,
        drop_reason: null,
        source_inference_id: sourceInferenceId
      };
    }
  };

  return service;
};
