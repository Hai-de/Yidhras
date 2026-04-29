import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../context.js';
import {
  type ActionIntentDispatchReflection,
  type ActionIntentRecord,
  claimActionIntent,
  getActionIntentForDispatchReflection,
  listDispatchableActionIntents,
  markActionIntentCompleted,
  markActionIntentDispatching,
  markActionIntentDropped,
  markActionIntentFailed,
  releaseActionIntentLock} from '../action_intent_repository.js';
import type {
  DecisionJobRecord,
  InferenceTraceRecord
} from '../inference_workflow/types.js';
import {
  claimDecisionJob,
  createPendingDecisionJob,
  createReplayDecisionJob,
  getDecisionJobById,
  getDecisionJobByIdempotencyKey,
  getDecisionJobByInferenceId,
  getInferenceTraceById,
  listRunnableDecisionJobs,
  releaseDecisionJobLock,
  updateDecisionJobState
} from '../inference_workflow/workflow_job_repository.js';

export type { ActionIntentRecord, DecisionJobRecord, InferenceTraceRecord };

export interface InferenceWorkflowRepository {
  // DecisionJob
  findManyPending(limit?: number): Promise<DecisionJobRecord[]>;
  claim(id: string, workerId: string, lockTicks?: bigint): Promise<DecisionJobRecord | null>;
  releaseLock(id: string, workerId?: string): Promise<DecisionJobRecord>;
  updateState(
    id: string,
    status: string,
    opts?: {
      lastError?: string | null;
      lastErrorCode?: string | null;
      lastErrorStage?: string | null;
      completedAt?: bigint | null;
      nextRetryAt?: bigint | null;
      startedAt?: bigint | null;
    }
  ): Promise<DecisionJobRecord>;
  createPending(input: {
    idempotencyKey: string;
    requestInput: unknown;
    maxAttempts?: number;
    scheduledForTick?: bigint | null;
    intentClass?: string;
    jobSource?: string;
  }): Promise<DecisionJobRecord>;
  createReplay(input: {
    sourceJob: DecisionJobRecord;
    sourceTraceId: string | null;
    requestInput: unknown;
    idempotencyKey: string;
    reason?: string | null;
    maxAttempts?: number;
    replayOverrideSnapshot?: Record<string, unknown> | null;
  }): Promise<DecisionJobRecord>;
  getById(id: string): Promise<DecisionJobRecord>;
  getByInferenceId(inferenceId: string): Promise<DecisionJobRecord>;
  getByIdempotencyKey(key: string): Promise<DecisionJobRecord | null>;
  getInferenceTraceById(inferenceId: string): Promise<InferenceTraceRecord>;

  // ActionIntent
  listDispatchableActionIntents(limit?: number): Promise<ActionIntentRecord[]>;
  claimActionIntent(
    intentId: string,
    workerId: string,
    opts?: { now?: bigint; lockTicks?: bigint }
  ): Promise<ActionIntentRecord | null>;
  releaseActionIntentLock(intentId: string, workerId?: string): Promise<ActionIntentRecord | null>;
  markActionIntentDispatching(intentId: string): Promise<ActionIntentRecord>;
  markActionIntentCompleted(intentId: string): Promise<ActionIntentRecord>;
  markActionIntentFailed(intentId: string, reason?: string | null, code?: string | null): Promise<ActionIntentRecord>;
  markActionIntentDropped(intentId: string, reason: string | null): Promise<ActionIntentRecord>;
  getActionIntentForDispatchReflection(intentId: string): Promise<ActionIntentDispatchReflection | null>;

  // Additional direct-Prisma methods
  listInferenceTraces(input: { orderBy?: Record<string, string>; take?: number }): Promise<unknown[]>;
  findAiInvocationById(id: string): Promise<unknown>;
  listAiInvocations(input: { where?: Record<string, unknown>; orderBy?: Record<string, unknown>; take?: number }): Promise<unknown[]>;
  findDecisionJobsByIds(ids: string[]): Promise<unknown[]>;
  listActionIntents(input: { where?: Record<string, unknown>; orderBy?: Record<string, unknown>; take?: number; select?: Record<string, boolean> }): Promise<unknown[]>;
  findActionIntentByInferenceId(inferenceId: string): Promise<unknown>;
  getPrisma(): PrismaClient;
}

export class PrismaInferenceWorkflowRepository implements InferenceWorkflowRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private ctx(): AppContext {
    return { prisma: this.prisma } as AppContext;
  }

  // -- DecisionJob --

  async findManyPending(limit?: number): Promise<DecisionJobRecord[]> {
    return listRunnableDecisionJobs(this.ctx(), limit);
  }

  async claim(id: string, workerId: string, lockTicks?: bigint): Promise<DecisionJobRecord | null> {
    return claimDecisionJob(this.ctx(), { job_id: id, worker_id: workerId, lock_ticks: lockTicks });
  }

  async releaseLock(id: string, workerId?: string): Promise<DecisionJobRecord> {
    return releaseDecisionJobLock(this.ctx(), { job_id: id, worker_id: workerId });
  }

  async updateState(
    id: string,
    status: string,
    opts?: {
      lastError?: string | null;
      lastErrorCode?: string | null;
      lastErrorStage?: string | null;
      completedAt?: bigint | null;
      nextRetryAt?: bigint | null;
      startedAt?: bigint | null;
    }
  ): Promise<DecisionJobRecord> {
    return updateDecisionJobState(this.ctx(), {
      job_id: id,
      status,
      last_error: opts?.lastError,
      last_error_code: opts?.lastErrorCode,
      last_error_stage: opts?.lastErrorStage,
      completed_at: opts?.completedAt,
      next_retry_at: opts?.nextRetryAt,
      started_at: opts?.startedAt
    });
  }

  async createPending(input: {
    idempotencyKey: string;
    requestInput: unknown;
    maxAttempts?: number;
    scheduledForTick?: bigint | null;
    intentClass?: string;
    jobSource?: string;
  }): Promise<DecisionJobRecord> {
    return createPendingDecisionJob(this.ctx(), {
      idempotency_key: input.idempotencyKey,
      request_input: input.requestInput as never,
      max_attempts: input.maxAttempts,
      scheduled_for_tick: input.scheduledForTick,
      intent_class: input.intentClass as never,
      job_source: input.jobSource
    });
  }

  async createReplay(input: {
    sourceJob: DecisionJobRecord;
    sourceTraceId: string | null;
    requestInput: unknown;
    idempotencyKey: string;
    reason?: string | null;
    maxAttempts?: number;
    replayOverrideSnapshot?: Record<string, unknown> | null;
  }): Promise<DecisionJobRecord> {
    return createReplayDecisionJob(this.ctx(), {
      source_job: input.sourceJob,
      source_trace_id: input.sourceTraceId,
      request_input: input.requestInput as never,
      idempotency_key: input.idempotencyKey,
      reason: input.reason,
      max_attempts: input.maxAttempts,
      replay_override_snapshot: input.replayOverrideSnapshot
    });
  }

  async getById(id: string): Promise<DecisionJobRecord> {
    return getDecisionJobById(this.ctx(), id);
  }

  async getByInferenceId(inferenceId: string): Promise<DecisionJobRecord> {
    return getDecisionJobByInferenceId(this.ctx(), inferenceId);
  }

  async getByIdempotencyKey(key: string): Promise<DecisionJobRecord | null> {
    return getDecisionJobByIdempotencyKey(this.ctx(), key);
  }

  async getInferenceTraceById(inferenceId: string): Promise<InferenceTraceRecord> {
    return getInferenceTraceById(this.ctx(), inferenceId);
  }

  // -- ActionIntent --

  async listDispatchableActionIntents(limit?: number): Promise<ActionIntentRecord[]> {
    return listDispatchableActionIntents(this.ctx(), limit);
  }

  async claimActionIntent(
    intentId: string,
    workerId: string,
    opts?: { now?: bigint; lockTicks?: bigint }
  ): Promise<ActionIntentRecord | null> {
    return claimActionIntent(this.ctx(), {
      intent_id: intentId,
      worker_id: workerId,
      now: opts?.now,
      lock_ticks: opts?.lockTicks
    });
  }

  async releaseActionIntentLock(
    intentId: string,
    workerId?: string
  ): Promise<ActionIntentRecord | null> {
    return releaseActionIntentLock(this.ctx(), { intent_id: intentId, worker_id: workerId });
  }

  async markActionIntentDispatching(intentId: string): Promise<ActionIntentRecord> {
    return markActionIntentDispatching(this.ctx(), intentId);
  }

  async markActionIntentCompleted(intentId: string): Promise<ActionIntentRecord> {
    return markActionIntentCompleted(this.ctx(), intentId);
  }

  async markActionIntentFailed(
    intentId: string,
    reason?: string | null,
    code?: string | null
  ): Promise<ActionIntentRecord> {
    return markActionIntentFailed(this.ctx(), intentId, reason, code);
  }

  async markActionIntentDropped(
    intentId: string,
    reason: string | null
  ): Promise<ActionIntentRecord> {
    return markActionIntentDropped(this.ctx(), intentId, reason);
  }

  async getActionIntentForDispatchReflection(
    intentId: string
  ): Promise<ActionIntentDispatchReflection | null> {
    return getActionIntentForDispatchReflection(this.ctx(), intentId);
  }

  // -- Additional direct-Prisma methods --

  async listInferenceTraces(input: { orderBy?: Record<string, string>; take?: number }): Promise<unknown[]> {
    return this.prisma.inferenceTrace.findMany({
      orderBy: input.orderBy as never ?? { created_at: 'desc' },
      take: input.take
    });
  }

  async findAiInvocationById(id: string): Promise<unknown> {
    return this.prisma.aiInvocationRecord.findUnique({ where: { id } });
  }

  async listAiInvocations(input: { where?: Record<string, unknown>; orderBy?: Record<string, unknown>; take?: number }): Promise<unknown[]> {
    return this.prisma.aiInvocationRecord.findMany({
      where: input.where as never,
      orderBy: input.orderBy as never ?? { created_at: 'desc' },
      take: input.take
    });
  }

  async findDecisionJobsByIds(ids: string[]): Promise<unknown[]> {
    return this.prisma.decisionJob.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, intent_class: true, created_at: true, completed_at: true }
    });
  }

  async listActionIntents(input: { where?: Record<string, unknown>; orderBy?: Record<string, unknown>; take?: number; select?: Record<string, boolean> }): Promise<unknown[]> {
    return this.prisma.actionIntent.findMany({
      where: input.where as never,
      orderBy: input.orderBy as never,
      take: input.take,
      select: input.select as never
    });
  }

  async findActionIntentByInferenceId(inferenceId: string): Promise<unknown> {
    return this.prisma.actionIntent.findUnique({ where: { source_inference_id: inferenceId } });
  }

  getPrisma(): PrismaClient { return this.prisma; }
}
