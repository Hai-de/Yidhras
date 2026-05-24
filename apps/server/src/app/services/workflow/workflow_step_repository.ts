import { Prisma, type PrismaClient } from '@prisma/client';

import type { WorkflowStepResultJson, WorkflowStepRunRecord, WorkflowStepRunStatus } from './workflow_types.js';

const RUNNABLE_WORKFLOW_STEP_STATUSES: WorkflowStepRunStatus[] = ['ready', 'running'];

export interface CreateWorkflowStepRunInput {
  workflow_run_id: string;
  step_id: string;
  agent_id: string;
  partition_id: number;
  status?: WorkflowStepRunStatus;
  dependency_step_ids: string[];
  input_step_ids: string[];
  attempt?: number;
  idempotency_key: string;
  now: bigint;
}

export interface CreateWorkflowStepRunsInput {
  steps: CreateWorkflowStepRunInput[];
}

export interface ListRunnableWorkflowStepsInput {
  workflow_run_id?: string;
  agent_ids?: string[];
  limit?: number;
  now: bigint;
}

export interface ClaimWorkflowStepInput {
  step_run_id: string;
  worker_id: string;
  now: bigint;
  lock_ticks: bigint;
}

export interface ListRunningWorkflowStepsInput {
  agent_ids?: string[];
  exclude_step_run_ids?: string[];
  limit?: number;
}

export interface CompleteWorkflowStepInput {
  step_run_id: string;
  result_json: WorkflowStepResultJson;
  action_intent_ids: string[];
  completed_tick: bigint;
  now: bigint;
  worker_id?: string;
}

export interface NarrativizeWorkflowStepInput {
  step_run_id: string;
  error_json?: Record<string, unknown> | null;
  completed_tick: bigint;
  now: bigint;
  worker_id?: string;
}

export interface FailWorkflowStepInput {
  step_run_id: string;
  error_json?: Record<string, unknown> | null;
  completed_tick: bigint;
  now: bigint;
  worker_id?: string;
}

export interface UpdateWorkflowStepStatusInput {
  step_run_id: string;
  status: WorkflowStepRunStatus;
  now: bigint;
}

export interface ReleaseWorkflowStepLockInput {
  step_run_id: string;
  status?: WorkflowStepRunStatus;
  now: bigint;
}

export interface WorkflowStepTerminalUpdateResult {
  updated: boolean;
}

export interface WorkflowStepRunRepository {
  createStepRuns(input: CreateWorkflowStepRunsInput): Promise<WorkflowStepRunRecord[]>;
  listStepRuns(workflowRunId: string): Promise<WorkflowStepRunRecord[]>;
  listRunnableSteps(input: ListRunnableWorkflowStepsInput): Promise<WorkflowStepRunRecord[]>;
  listRunningSteps(input?: ListRunningWorkflowStepsInput): Promise<WorkflowStepRunRecord[]>;
  claimStep(input: ClaimWorkflowStepInput): Promise<WorkflowStepRunRecord | null>;
  completeStep(input: CompleteWorkflowStepInput): Promise<WorkflowStepTerminalUpdateResult>;
  narrativizeStep(input: NarrativizeWorkflowStepInput): Promise<WorkflowStepTerminalUpdateResult>;
  failStep(input: FailWorkflowStepInput): Promise<WorkflowStepTerminalUpdateResult>;
  updateStepStatus(input: UpdateWorkflowStepStatusInput): Promise<void>;
  releaseStepLock(input: ReleaseWorkflowStepLockInput): Promise<void>;
}

type WorkflowStepRunRow = Prisma.WorkflowStepRunGetPayload<Record<string, never>>;

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
};

const toStringArray = (value: unknown): string[] => isStringArray(value) ? value : [];

const toWorkflowStepResultJson = (value: unknown): WorkflowStepResultJson | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
  return value as WorkflowStepResultJson;
};

const toErrorJson = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- runtime-guarded object access
  return value as Record<string, unknown>;
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
const toInputJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const toNullableInputJson = (value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull => {
  return value === null || value === undefined ? Prisma.JsonNull : toInputJson(value);
};

const toWorkflowStepRunRecord = (row: WorkflowStepRunRow): WorkflowStepRunRecord => ({
  id: row.id,
  workflow_run_id: row.workflow_run_id,
  step_id: row.step_id,
  agent_id: row.agent_id,
  partition_id: row.partition_id,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
  status: row.status as WorkflowStepRunStatus,
  dependency_step_ids: toStringArray(row.dependency_step_ids),
  input_step_ids: toStringArray(row.input_step_ids),
  result_json: toWorkflowStepResultJson(row.result_json),
  error_json: toErrorJson(row.error_json),
  action_intent_ids: toStringArray(row.action_intent_ids),
  attempt: row.attempt,
  started_tick: row.started_tick,
  completed_tick: row.completed_tick,
  lock_worker_id: row.lock_worker_id,
  lock_expires_at: row.lock_expires_at,
  idempotency_key: row.idempotency_key
});

export class PrismaWorkflowStepRunRepository implements WorkflowStepRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createStepRuns(input: CreateWorkflowStepRunsInput): Promise<WorkflowStepRunRecord[]> {
    if (input.steps.length === 0) {
      return [];
    }

    await this.prisma.workflowStepRun.createMany({
      data: input.steps.map(step => ({
        workflow_run_id: step.workflow_run_id,
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
        idempotency_key: step.idempotency_key,
        created_at: step.now,
        updated_at: step.now
      }))
    });

    const workflowRunId = input.steps[0]?.workflow_run_id;
    if (!workflowRunId) {
      return [];
    }
    return this.listStepRuns(workflowRunId);
  }

  async listStepRuns(workflowRunId: string): Promise<WorkflowStepRunRecord[]> {
    const rows = await this.prisma.workflowStepRun.findMany({
      where: { workflow_run_id: workflowRunId },
      orderBy: { created_at: 'asc' }
    });

    return rows.map(toWorkflowStepRunRecord);
  }

  async listRunnableSteps(input: ListRunnableWorkflowStepsInput): Promise<WorkflowStepRunRecord[]> {
    const rows = await this.prisma.workflowStepRun.findMany({
      where: {
        status: { in: RUNNABLE_WORKFLOW_STEP_STATUSES },
        ...(input.workflow_run_id ? { workflow_run_id: input.workflow_run_id } : {}),
        ...(input.agent_ids && input.agent_ids.length > 0 ? { agent_id: { in: input.agent_ids } } : {}),
        OR: [
          { lock_worker_id: null },
          { lock_expires_at: null },
          { lock_expires_at: { lte: input.now } }
        ]
      },
      orderBy: { updated_at: 'asc' },
      take: input.limit
    });

    return rows.map(toWorkflowStepRunRecord);
  }

  async listRunningSteps(input: ListRunningWorkflowStepsInput = {}): Promise<WorkflowStepRunRecord[]> {
    const rows = await this.prisma.workflowStepRun.findMany({
      where: {
        status: 'running',
        ...(input.agent_ids && input.agent_ids.length > 0 ? { agent_id: { in: input.agent_ids } } : {}),
        ...(input.exclude_step_run_ids && input.exclude_step_run_ids.length > 0 ? { id: { notIn: input.exclude_step_run_ids } } : {})
      },
      orderBy: {
        updated_at: 'asc'
      },
      take: input.limit
    });

    return rows.map(toWorkflowStepRunRecord);
  }

  async claimStep(input: ClaimWorkflowStepInput): Promise<WorkflowStepRunRecord | null> {
    const updated = await this.prisma.workflowStepRun.updateMany({
      where: {
        id: input.step_run_id,
        status: { in: RUNNABLE_WORKFLOW_STEP_STATUSES },
        OR: [
          { lock_worker_id: null },
          { lock_expires_at: null },
          { lock_expires_at: { lte: input.now } }
        ]
      },
      data: {
        status: 'running',
        started_tick: input.now,
        lock_worker_id: input.worker_id,
        lock_expires_at: input.now + input.lock_ticks,
        updated_at: input.now
      }
    });

    if (updated.count === 0) {
      return null;
    }

    const row = await this.prisma.workflowStepRun.findUnique({ where: { id: input.step_run_id } });
    return row ? toWorkflowStepRunRecord(row) : null;
  }

  async completeStep(input: CompleteWorkflowStepInput): Promise<WorkflowStepTerminalUpdateResult> {
    return this.updateTerminalStep({
      step_run_id: input.step_run_id,
      status: 'completed',
      result_json: input.result_json,
      error_json: null,
      action_intent_ids: input.action_intent_ids,
      completed_tick: input.completed_tick,
      now: input.now,
      worker_id: input.worker_id
    });
  }

  async narrativizeStep(input: NarrativizeWorkflowStepInput): Promise<WorkflowStepTerminalUpdateResult> {
    return this.updateTerminalStep({
      step_run_id: input.step_run_id,
      status: 'narrativized',
      result_json: null,
      error_json: input.error_json ?? null,
      action_intent_ids: [],
      completed_tick: input.completed_tick,
      now: input.now,
      worker_id: input.worker_id
    });
  }

  async failStep(input: FailWorkflowStepInput): Promise<WorkflowStepTerminalUpdateResult> {
    return this.updateTerminalStep({
      step_run_id: input.step_run_id,
      status: 'failed',
      result_json: null,
      error_json: input.error_json ?? null,
      action_intent_ids: [],
      completed_tick: input.completed_tick,
      now: input.now,
      worker_id: input.worker_id
    });
  }

  async updateStepStatus(input: UpdateWorkflowStepStatusInput): Promise<void> {
    await this.prisma.workflowStepRun.update({
      where: { id: input.step_run_id },
      data: {
        status: input.status,
        updated_at: input.now
      }
    });
  }

  async releaseStepLock(input: ReleaseWorkflowStepLockInput): Promise<void> {
    await this.prisma.workflowStepRun.update({
      where: { id: input.step_run_id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        lock_worker_id: null,
        lock_expires_at: null,
        updated_at: input.now
      }
    });
  }

  private async updateTerminalStep(input: {
    step_run_id: string;
    status: WorkflowStepRunStatus;
    result_json: WorkflowStepResultJson | null;
    error_json: Record<string, unknown> | null;
    action_intent_ids: string[];
    completed_tick: bigint;
    now: bigint;
    worker_id?: string;
  }): Promise<WorkflowStepTerminalUpdateResult> {
    const updated = await this.prisma.workflowStepRun.updateMany({
      where: {
        id: input.step_run_id,
        ...(input.worker_id ? { lock_worker_id: input.worker_id } : {})
      },
      data: {
        status: input.status,
        result_json: toNullableInputJson(input.result_json),
        error_json: toNullableInputJson(input.error_json),
        action_intent_ids: toInputJson(input.action_intent_ids),
        completed_tick: input.completed_tick,
        lock_worker_id: null,
        lock_expires_at: null,
        updated_at: input.now
      }
    });
    if (updated.count === 0) {
      return { updated: false };
    }
    if (updated.count !== 1) {
      throw new Error(`Expected exactly one workflow step terminal update, got ${updated.count}`);
    }
    return { updated: true };
  }
}
