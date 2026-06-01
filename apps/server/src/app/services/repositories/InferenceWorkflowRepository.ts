import { Prisma, type PrismaClient } from '@prisma/client';

import type { InferenceJobIntentClass, InferenceRequestInput } from '../../../inference/types.js';
import type { DbContext } from '../../../utils/db_context.js';
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
  releaseActionIntentLock} from '../action/action_intent_repository.js';
import type {
  ActionIntentRecord as ActionIntentRecordFull,
  AiInvocationRecord,
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
    requestInput: InferenceRequestInput;
    maxAttempts?: number;
    scheduledForTick?: bigint | null;
    intentClass?: InferenceJobIntentClass;
    jobSource?: string;
  }): Promise<DecisionJobRecord>;
  createReplay(input: {
    sourceJob: DecisionJobRecord;
    sourceTraceId: string | null;
    requestInput: InferenceRequestInput;
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
  listInferenceTraces(input: { orderBy?: Prisma.InferenceTraceOrderByWithRelationInput; take?: number; where?: Prisma.InferenceTraceWhereInput; include?: Prisma.InferenceTraceInclude }): Promise<InferenceTraceRecord[]>;
  findAiInvocationById(id: string): Promise<AiInvocationRecord | null>;
  listAiInvocations(input: { where?: Prisma.AiInvocationRecordWhereInput; orderBy?: Prisma.AiInvocationRecordOrderByWithRelationInput | Prisma.AiInvocationRecordOrderByWithRelationInput[]; take?: number }): Promise<AiInvocationRecord[]>;
  findDecisionJobsByIds(ids: string[]): Promise<unknown[]>;
  listActionIntents(input: { where?: Prisma.ActionIntentWhereInput; orderBy?: Prisma.ActionIntentOrderByWithRelationInput; take?: number; select?: Prisma.ActionIntentSelect }): Promise<ActionIntentRecordFull[]>;
  findDecisionJobs<T = DecisionJobRecord>(input: { where?: Prisma.DecisionJobWhereInput; orderBy?: Prisma.DecisionJobOrderByWithRelationInput | Prisma.DecisionJobOrderByWithRelationInput[]; take?: number; include?: Prisma.DecisionJobInclude; select?: Prisma.DecisionJobSelect }): Promise<T[]>;
  findActionIntentByInferenceId(inferenceId: string): Promise<ActionIntentRecordFull | null>;
  findActionIntentById(id: string): Promise<ActionIntentRecordFull | null>;
  upsertAiInvocation(input: Prisma.AiInvocationRecordUpsertArgs): Promise<unknown>;
  transaction<T>(fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>) => Promise<T>): Promise<T>;
}

export class PrismaInferenceWorkflowRepository implements InferenceWorkflowRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private ctx() {
     
    return { prisma: this.prisma } as DbContext;
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
// @ts-expect-error -- EOPT strict mode
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
    requestInput: InferenceRequestInput;
    maxAttempts?: number;
    scheduledForTick?: bigint | null;
    intentClass?: InferenceJobIntentClass;
    jobSource?: string;
  }): Promise<DecisionJobRecord> {
    return createPendingDecisionJob(this.ctx(), {
      idempotency_key: input.idempotencyKey,
      request_input: input.requestInput,
      max_attempts: input.maxAttempts,
      scheduled_for_tick: input.scheduledForTick,
      intent_class: input.intentClass,
      job_source: input.jobSource
    });
  }

  async createReplay(input: {
    sourceJob: DecisionJobRecord;
    sourceTraceId: string | null;
    requestInput: InferenceRequestInput;
    idempotencyKey: string;
    reason?: string | null;
    maxAttempts?: number;
    replayOverrideSnapshot?: Record<string, unknown> | null;
  }): Promise<DecisionJobRecord> {
    return createReplayDecisionJob(this.ctx(), {
      source_job: input.sourceJob,
      source_trace_id: input.sourceTraceId,
      request_input: input.requestInput,
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
// @ts-expect-error -- EOPT strict mode
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
// @ts-expect-error -- EOPT strict mode
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

  async listInferenceTraces(input: { orderBy?: Prisma.InferenceTraceOrderByWithRelationInput; take?: number; where?: Prisma.InferenceTraceWhereInput; include?: Prisma.InferenceTraceInclude }): Promise<InferenceTraceRecord[]> {
// @ts-expect-error -- EOPT strict mode
    return await this.prisma.inferenceTrace.findMany({
      orderBy: input.orderBy ?? { created_at: 'desc' },
      take: input.take,
      where: input.where,
      include: input.include
    });
  }

  async findAiInvocationById(id: string): Promise<AiInvocationRecord | null> {
    return this.prisma.aiInvocationRecord.findUnique({ where: { id } });
  }

  async listAiInvocations(input: { where?: Prisma.AiInvocationRecordWhereInput; orderBy?: Prisma.AiInvocationRecordOrderByWithRelationInput | Prisma.AiInvocationRecordOrderByWithRelationInput[]; take?: number }): Promise<AiInvocationRecord[]> {
// @ts-expect-error -- EOPT strict mode
    return await this.prisma.aiInvocationRecord.findMany({
      where: input.where,
      orderBy: input.orderBy ?? { created_at: 'desc' },
      take: input.take
    });
  }

  async findDecisionJobsByIds(ids: string[]): Promise<unknown[]> {
    return this.prisma.decisionJob.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, intent_class: true, created_at: true, completed_at: true }
    });
  }

  async listActionIntents(input: { where?: Prisma.ActionIntentWhereInput; orderBy?: Prisma.ActionIntentOrderByWithRelationInput; take?: number; select?: Prisma.ActionIntentSelect }): Promise<ActionIntentRecordFull[]> {
// @ts-expect-error -- EOPT strict mode
    return await this.prisma.actionIntent.findMany({
      where: input.where,
      orderBy: input.orderBy,
      take: input.take,
      select: input.select
    });
  }

  async findActionIntentByInferenceId(inferenceId: string): Promise<ActionIntentRecordFull | null> {
    return this.prisma.actionIntent.findUnique({ where: { source_inference_id: inferenceId } });
  }

  async findActionIntentById(id: string): Promise<ActionIntentRecordFull | null> {
    return this.prisma.actionIntent.findUnique({ where: { id } });
  }

  async findDecisionJobs<T = DecisionJobRecord>(input: { where?: Prisma.DecisionJobWhereInput; orderBy?: Prisma.DecisionJobOrderByWithRelationInput | Prisma.DecisionJobOrderByWithRelationInput[]; take?: number; include?: Prisma.DecisionJobInclude; select?: Prisma.DecisionJobSelect }): Promise<T[]> {
    const { include, select, ...rest } = input;
    const args: Prisma.DecisionJobFindManyArgs = { ...rest, ...(include ? { include } : {}), ...(select ? { select } : {}) };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    return await this.prisma.decisionJob.findMany(args) as T[];
  }

  async upsertAiInvocation(input: Prisma.AiInvocationRecordUpsertArgs): Promise<unknown> {
    return this.prisma.aiInvocationRecord.upsert(input);
  }

  async transaction<T>(fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
