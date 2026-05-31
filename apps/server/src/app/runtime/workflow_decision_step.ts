import { getSchedulerTickBudgetConfig } from '../../config/runtime_config.js';
import type { WorkflowInferencePort } from '../../inference/workflow_inference_port.js';
import type { AppContext } from '../context.js';
import type { PackRuntimePort } from '../services/pack/pack_runtime_ports.js';
import { createWorkflowEngine } from '../services/workflow/workflow_engine.js';
import type { WorkflowAdvanceBudget, WorkflowAdvanceResult, WorkflowRecoveryResult } from '../services/workflow/workflow_types.js';
import { runDecisionJobRunner } from './job_runner.js';

export interface WorkflowDecisionStepEngine {
  recoverExpiredRuns(input: {
    context: AppContext;
    packRuntime: PackRuntimePort;
    workerId: string;
    tick: bigint;
  }): Promise<WorkflowRecoveryResult>;

  advance(input: {
    context: AppContext;
    inferenceService: WorkflowInferencePort;
    packRuntime: PackRuntimePort;
    workerId: string;
    tick: bigint;
    budget: WorkflowAdvanceBudget;
  }): Promise<WorkflowAdvanceResult>;
}

export interface WorkflowDecisionStepResult {
  recovery: WorkflowRecoveryResult;
  workflow_advance: WorkflowAdvanceResult;
  executed_decision_job_count: number;
}

export interface RunWorkflowDecisionStepInput {
  context: AppContext;
  inferenceService: WorkflowInferencePort;
  workerId: string;
  packRuntime: PackRuntimePort;
  workflowEngine?: WorkflowDecisionStepEngine;
  decisionJobLimit?: number;
  decisionJobConcurrency?: number;
  decisionJobLockTicks?: bigint;
  workflowBudget?: WorkflowAdvanceBudget;
}

const buildDefaultWorkflowAdvanceBudget = (packRuntime: PackRuntimePort): WorkflowAdvanceBudget => {
  const tickBudget = getSchedulerTickBudgetConfig();
  return {
    max_rounds_per_tick: Math.max(1, tickBudget.max_executed_decisions_per_tick),
    max_steps_per_tick: Math.max(1, tickBudget.max_executed_decisions_per_tick),
    max_wall_time_ms_per_tick: Math.max(1, Math.floor(packRuntime.getLoopIntervalMs() / 2))
  };
};

export const runWorkflowDecisionStep = async (input: RunWorkflowDecisionStepInput): Promise<WorkflowDecisionStepResult> => {
  const workflowEngine = input.workflowEngine ?? createWorkflowEngine();
  const tick = input.packRuntime.getCurrentTick();
  const budget = input.workflowBudget ?? buildDefaultWorkflowAdvanceBudget(input.packRuntime);

  const recovery = await workflowEngine.recoverExpiredRuns({
    context: input.context,
    packRuntime: input.packRuntime,
    workerId: input.workerId,
    tick
  });

  const workflowAdvance = await workflowEngine.advance({
    context: input.context,
    inferenceService: input.inferenceService,
    packRuntime: input.packRuntime,
    workerId: input.workerId,
    tick,
    budget
  });

// @ts-expect-error -- EOPT strict mode
  const executedDecisionJobCount = await runDecisionJobRunner({
    context: input.context,
    inferenceService: input.inferenceService,
    workerId: input.workerId,
    packRuntime: input.packRuntime,
    limit: input.decisionJobLimit,
    concurrency: input.decisionJobConcurrency,
    lockTicks: input.decisionJobLockTicks
  });

  return {
    recovery,
    workflow_advance: workflowAdvance,
    executed_decision_job_count: executedDecisionJobCount
  };
};
