import { Prisma, type PrismaClient } from '@prisma/client';

import type { CreateWorkflowStepRunInput } from './workflow_step_repository.js';
import type { WorkflowRunRecord, WorkflowRunStatus } from './workflow_types.js';

const ACTIVE_WORKFLOW_RUN_STATUSES: WorkflowRunStatus[] = ['pending', 'running'];

export interface CreateWorkflowRunInput {
  workflow_name: string;
  pack_id: string;
  status?: WorkflowRunStatus;
  created_tick: bigint;
  last_advance_tick?: bigint;
  max_ticks: number;
  trigger_type: 'manual' | 'event';
  trigger_ref: string | null;
  lock_worker_id?: string | null;
  lock_expires_at?: bigint | null;
  idempotency_key: string;
  now: bigint;
}

export interface ListActiveWorkflowRunsInput {
  pack_id?: string;
  limit?: number;
}

export interface ClaimWorkflowRunInput {
  run_id: string;
  worker_id: string;
  now: bigint;
  lock_ticks: bigint;
}

export interface UpdateWorkflowRunStatusInput {
  run_id: string;
  status: WorkflowRunStatus;
  last_advance_tick?: bigint;
  lock_worker_id?: string | null;
  lock_expires_at?: bigint | null;
  now: bigint;
}

export interface WorkflowRunRepository {
  createRun(input: CreateWorkflowRunInput): Promise<WorkflowRunRecord>;
  createRunWithStepsIdempotent(input: {
    run: CreateWorkflowRunInput;
    steps: Omit<CreateWorkflowStepRunInput, 'workflow_run_id' | 'idempotency_key'>[];
  }): Promise<{ run: WorkflowRunRecord; created: boolean }>;
  getRunById(id: string): Promise<WorkflowRunRecord | null>;
  getRunByIdempotencyKey(idempotencyKey: string): Promise<WorkflowRunRecord | null>;
  listActiveRuns(input?: ListActiveWorkflowRunsInput): Promise<WorkflowRunRecord[]>;
  claimRun(input: ClaimWorkflowRunInput): Promise<WorkflowRunRecord | null>;
  updateRunStatus(input: UpdateWorkflowRunStatusInput): Promise<void>;
}

type WorkflowRunRow = Prisma.WorkflowRunGetPayload<Record<string, never>>;

const toWorkflowRunRecord = (row: WorkflowRunRow): WorkflowRunRecord => ({
  id: row.id,
  workflow_name: row.workflow_name,
  pack_id: row.pack_id,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
  status: row.status as WorkflowRunStatus,
  created_tick: row.created_tick,
  last_advance_tick: row.last_advance_tick,
  max_ticks: row.max_ticks,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
  trigger_type: row.trigger_type as 'manual' | 'event',
  trigger_ref: row.trigger_ref,
  lock_worker_id: row.lock_worker_id,
  lock_expires_at: row.lock_expires_at,
  idempotency_key: row.idempotency_key
});


// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
const toInputJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const isUniqueConstraintError = (err: unknown): boolean => {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
};

export class PrismaWorkflowRunRepository implements WorkflowRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createRun(input: CreateWorkflowRunInput): Promise<WorkflowRunRecord> {
    const row = await this.prisma.workflowRun.create({
      data: {
        workflow_name: input.workflow_name,
        pack_id: input.pack_id,
        status: input.status ?? 'pending',
        created_tick: input.created_tick,
        last_advance_tick: input.last_advance_tick ?? input.created_tick,
        max_ticks: input.max_ticks,
        trigger_type: input.trigger_type,
        trigger_ref: input.trigger_ref,
        lock_worker_id: input.lock_worker_id ?? null,
        lock_expires_at: input.lock_expires_at ?? null,
        idempotency_key: input.idempotency_key,
        created_at: input.now,
        updated_at: input.now
      }
    });

    return toWorkflowRunRecord(row);
  }

  async createRunWithStepsIdempotent(input: {
    run: CreateWorkflowRunInput;
    steps: Omit<CreateWorkflowStepRunInput, 'workflow_run_id' | 'idempotency_key'>[];
  }): Promise<{ run: WorkflowRunRecord; created: boolean }> {
    try {
      const row = await this.prisma.$transaction(async tx => {
        const run = await tx.workflowRun.create({
          data: {
            workflow_name: input.run.workflow_name,
            pack_id: input.run.pack_id,
            status: input.run.status ?? 'pending',
            created_tick: input.run.created_tick,
            last_advance_tick: input.run.last_advance_tick ?? input.run.created_tick,
            max_ticks: input.run.max_ticks,
            trigger_type: input.run.trigger_type,
            trigger_ref: input.run.trigger_ref,
            lock_worker_id: input.run.lock_worker_id ?? null,
            lock_expires_at: input.run.lock_expires_at ?? null,
            idempotency_key: input.run.idempotency_key,
            created_at: input.run.now,
            updated_at: input.run.now
          }
        });

        if (input.steps.length > 0) {
          await tx.workflowStepRun.createMany({
            data: input.steps.map(step => ({
              workflow_run_id: run.id,
              step_id: step.step_id,
              agent_id: step.agent_id,
              partition_id: step.partition_id,
              status: step.status ?? 'pending',
              dependency_step_ids: toInputJson(step.dependency_step_ids),
              input_step_ids: toInputJson(step.input_step_ids),
              result_json: Prisma.JsonNull,
              error_json: Prisma.JsonNull,
              action_intent_ids: toInputJson([]),
              attempt: step.attempt ?? 1,
              started_tick: null,
              completed_tick: null,
              lock_worker_id: null,
              lock_expires_at: null,
              idempotency_key: `wfstep:${run.id}:${step.step_id}:${step.attempt ?? 1}`,
              created_at: step.now,
              updated_at: step.now
            }))
          });
        }

        return run;
      });
      return { run: toWorkflowRunRecord(row), created: true };
    } catch (err: unknown) {
      if (!isUniqueConstraintError(err)) {
        throw err;
      }
      const existing = await this.getRunByIdempotencyKey(input.run.idempotency_key);
      if (!existing) {
        throw err;
      }
      return { run: existing, created: false };
    }
  }

  async getRunById(id: string): Promise<WorkflowRunRecord | null> {
    const row = await this.prisma.workflowRun.findUnique({ where: { id } });
    return row ? toWorkflowRunRecord(row) : null;
  }

  async getRunByIdempotencyKey(idempotencyKey: string): Promise<WorkflowRunRecord | null> {
    const row = await this.prisma.workflowRun.findUnique({ where: { idempotency_key: idempotencyKey } });
    return row ? toWorkflowRunRecord(row) : null;
  }

  async listActiveRuns(input: ListActiveWorkflowRunsInput = {}): Promise<WorkflowRunRecord[]> {
// @ts-expect-error -- EOPT strict mode
    const rows = await this.prisma.workflowRun.findMany({
      where: {
        status: { in: ACTIVE_WORKFLOW_RUN_STATUSES },
        ...(input.pack_id ? { pack_id: input.pack_id } : {})
      },
      orderBy: { updated_at: 'asc' },
      take: input.limit
    });

    return rows.map(toWorkflowRunRecord);
  }

  async claimRun(input: ClaimWorkflowRunInput): Promise<WorkflowRunRecord | null> {
    const updated = await this.prisma.workflowRun.updateMany({
      where: {
        id: input.run_id,
        status: { in: ACTIVE_WORKFLOW_RUN_STATUSES },
        OR: [
          { lock_worker_id: null },
          { lock_expires_at: null },
          { lock_expires_at: { lte: input.now } }
        ]
      },
      data: {
        status: 'running',
        lock_worker_id: input.worker_id,
        lock_expires_at: input.now + input.lock_ticks,
        updated_at: input.now
      }
    });

    if (updated.count === 0) {
      return null;
    }

    return this.getRunById(input.run_id);
  }

  async updateRunStatus(input: UpdateWorkflowRunStatusInput): Promise<void> {
    await this.prisma.workflowRun.update({
      where: { id: input.run_id },
// @ts-expect-error -- EOPT strict mode
      data: {
        status: input.status,
        last_advance_tick: input.last_advance_tick,
        lock_worker_id: input.lock_worker_id,
        lock_expires_at: input.lock_expires_at,
        updated_at: input.now
      }
    });
  }
}
