import type { InferenceJobSubmitResult, InferenceRequestInput, InferenceRunResult } from '../../../inference/types.js';
import type { WorldPackWorkflowDefinition, WorldPackWorkflowStep } from '../../../packs/schema/constitution_schema.js';
import { ApiError } from '../../../utils/api_error.js';
import { getErrorMessage } from '../../http/errors.js';
import {
  checkWorkflowBudget,
  createWorkflowBudgetState,
  incrementWorkflowBudgetRound,
  incrementWorkflowBudgetSteps,
  type WorkflowBudgetState
} from './workflow_budget.js';
import { evaluateWorkflowCondition } from './workflow_condition.js';
import {
  buildPreviousAgentOutputScope,
  hasAllRequiredPreviousAgentOutputs
} from './workflow_previous_output.js';
import { hasActiveWorkflowForActor } from './workflow_single_flight.js';
import type {
  TriggerWorkflowInput,
  WorkflowAdvanceInput,
  WorkflowAdvanceResult,
  WorkflowRecoveryInput,
  WorkflowRecoveryResult,
  WorkflowRunRecord,
  WorkflowStepResultJson,
  WorkflowStepRunRecord,
  WorkflowStepRunStatus
} from './workflow_types.js';

const DEFAULT_WORKFLOW_RUN_LOCK_TICKS = 5n;
const DEFAULT_WORKFLOW_STEP_LOCK_TICKS = 5n;

type WorkflowStepExecutionOutcome = 'completed' | 'failed' | 'narrativized' | 'lock_lost';

const TERMINAL_STEP_STATUSES = new Set<WorkflowStepRunStatus>([
  'completed',
  'failed',
  'skipped',
  'narrativized',
  'timed_out'
]);

const SUCCESSFUL_DEPENDENCY_STATUSES = new Set<WorkflowStepRunStatus>([
  'completed',
  'skipped',
  'narrativized'
]);

const getWorkflowDefinition = (
  input: Pick<TriggerWorkflowInput, 'packRuntime' | 'workflow_name'>
): WorldPackWorkflowDefinition => {
  const pack = input.packRuntime.getPack();
  const workflow = pack.workflows?.[input.workflow_name];
  if (!workflow) {
    throw new ApiError(404, 'WORKFLOW_NOT_FOUND', 'Workflow definition not found in pack', {
      workflow_name: input.workflow_name,
      pack_id: pack.metadata.id
    });
  }
  return workflow;
};

const getWorkflowDefinitionForRun = (
  packRuntime: WorkflowAdvanceInput['packRuntime'],
  run: WorkflowRunRecord
): WorldPackWorkflowDefinition | null => {
  return packRuntime.getPack().workflows?.[run.workflow_name] ?? null;
};

const buildWorkflowRunIdempotencyKey = (input: TriggerWorkflowInput): string => {
  return [
    'wf',
    input.packRuntime.getPack().metadata.id,
    input.workflow_name,
    input.trigger_type,
    input.trigger_tick.toString(),
    input.trigger_ref ?? 'none'
  ].join(':');
};

const getStepDependencies = (step: WorldPackWorkflowStep): string[] => step.depends_on ?? [];

const getStepInputs = (step: WorldPackWorkflowStep): string[] => step.input_from ?? [];

const mapStepById = (workflow: WorldPackWorkflowDefinition): Map<string, WorldPackWorkflowStep> => {
  return new Map(workflow.steps.map(step => [step.id, step]));
};

const mapStepRunByStepId = (steps: WorkflowStepRunRecord[]): Map<string, WorkflowStepRunRecord> => {
  return new Map(steps.map(step => [step.step_id, step]));
};

const isTerminalStep = (step: WorkflowStepRunRecord): boolean => TERMINAL_STEP_STATUSES.has(step.status);

const isRunTimedOut = (run: WorkflowRunRecord, tick: bigint): boolean => {
  return tick - run.created_tick >= BigInt(run.max_ticks);
};

const toStepInferenceStrategy = (step: WorldPackWorkflowStep): InferenceRequestInput['strategy'] => {
  return step.inference.provider === 'behavior_tree' ? 'behavior_tree' : 'model_routed';
};

const toStepInferenceAttributes = (step: WorldPackWorkflowStep): Record<string, unknown> => {
  if (step.inference.provider === 'behavior_tree') {
    return {
      workflow_step_id: step.id,
      inference_provider: step.inference.provider,
      behavior_tree: step.inference.behavior_tree
    };
  }

  return {
    workflow_step_id: step.id,
    inference_provider: step.inference.provider,
    model: step.inference.model
  };
};

const toWorkflowStepResultJson = (
  result: InferenceRunResult,
  actionIntentIds: string[]
): WorkflowStepResultJson => {
  const semanticIntent =
    typeof result.decision.payload.semantic_intent_kind === 'string'
      ? result.decision.payload.semantic_intent_kind
      : result.decision.action_type;

  return {
    reasoning: result.decision.reasoning ?? null,
    decision_summary: result.decision.action_type,
    grounding_result: {
      type: 'exact',
      semantic_intent: semanticIntent
    },
    inference_id: result.inference_id,
    action_intent_ids: actionIntentIds
  };
};

const buildCompletedStepResults = (steps: WorkflowStepRunRecord[]): Map<string, WorkflowStepResultJson> => {
  return new Map(
    steps
      .filter(step => step.status === 'completed' && step.result_json !== null)
      .map(step => [step.step_id, step.result_json as WorkflowStepResultJson])
  );
};

const isStepReady = (
  stepDefinition: WorldPackWorkflowStep,
  stepRun: WorkflowStepRunRecord,
  stepRunByStepId: Map<string, WorkflowStepRunRecord>
): boolean => {
  if (stepRun.status !== 'pending') {
    return false;
  }

  if (!hasAllRequiredPreviousAgentOutputs({ inputStepIds: getStepInputs(stepDefinition), stepRuns: Array.from(stepRunByStepId.values()) })) {
    return false;
  }

  return getStepDependencies(stepDefinition).every(dependencyStepId => {
    const dependency = stepRunByStepId.get(dependencyStepId);
    return dependency ? SUCCESSFUL_DEPENDENCY_STATUSES.has(dependency.status) : false;
  });
};

const resolveRunTerminalStatus = (steps: WorkflowStepRunRecord[]): WorkflowRunRecord['status'] | null => {
  if (steps.some(step => step.status === 'failed')) {
    return 'failed';
  }
  if (steps.some(step => step.status === 'timed_out')) {
    return 'timed_out';
  }
  if (!steps.every(isTerminalStep)) {
    return null;
  }
  if (steps.some(step => step.status === 'narrativized')) {
    return 'narrativized';
  }
  return 'completed';
};

export class WorkflowEngine {
  async triggerWorkflow(input: TriggerWorkflowInput): Promise<WorkflowRunRecord> {
    const workflow = getWorkflowDefinition(input);
    const packId = input.packRuntime.getPack().metadata.id;
    const idempotencyKey = buildWorkflowRunIdempotencyKey(input);
    const created = await input.context.repos.workflowRuns.createRunWithStepsIdempotent({
      run: {
        workflow_name: input.workflow_name,
        pack_id: packId,
        created_tick: input.trigger_tick,
        last_advance_tick: input.trigger_tick,
        max_ticks: workflow.max_ticks,
        trigger_type: input.trigger_type,
        trigger_ref: input.trigger_ref,
        idempotency_key: idempotencyKey,
        now: input.trigger_tick
      },
      steps: workflow.steps.map((step, index) => ({
        step_id: step.id,
        agent_id: step.agent,
        partition_id: index,
        status: 'pending',
        dependency_step_ids: getStepDependencies(step),
        input_step_ids: getStepInputs(step),
        attempt: 1,
        now: input.trigger_tick
      }))
    });

    return created.run;
  }

  async recoverExpiredRuns(input: WorkflowRecoveryInput): Promise<WorkflowRecoveryResult> {
    const activeRuns = await input.context.repos.workflowRuns.listActiveRuns({
      pack_id: input.packRuntime.getPack().metadata.id
    });
    let expiredRunCount = 0;
    let expiredStepCount = 0;
    let recoveredStepCount = 0;

    for (const run of activeRuns) {
      if (run.lock_worker_id !== null && run.lock_expires_at !== null && run.lock_expires_at <= input.tick) {
        expiredRunCount += 1;
        await input.context.repos.workflowRuns.updateRunStatus({
          run_id: run.id,
          status: 'pending',
          lock_worker_id: null,
          lock_expires_at: null,
          now: input.tick
        });
      }

      const steps = await input.context.repos.workflowSteps.listStepRuns(run.id);
      for (const step of steps) {
        if (step.status !== 'running' || step.lock_expires_at === null || step.lock_expires_at > input.tick) {
          continue;
        }
        expiredStepCount += 1;
        await input.context.repos.workflowSteps.releaseStepLock({
          step_run_id: step.id,
          status: 'ready',
          now: input.tick
        });
        recoveredStepCount += 1;
      }
    }

    return {
      expired_run_count: expiredRunCount,
      expired_step_count: expiredStepCount,
      recovered_step_count: recoveredStepCount,
      failed_step_count: 0
    };
  }

  async advance(input: WorkflowAdvanceInput): Promise<WorkflowAdvanceResult> {
    let budgetState = createWorkflowBudgetState();
    const result: WorkflowAdvanceResult = {
      advanced_run_count: 0,
      executed_step_count: 0,
      completed_run_count: 0,
      failed_run_count: 0,
      narrativized_run_count: 0,
      budget_exhausted: false
    };

    const activeRuns = await input.context.repos.workflowRuns.listActiveRuns({
      pack_id: input.packRuntime.getPack().metadata.id
    });

    for (const run of activeRuns) {
      const budgetCheck = checkWorkflowBudget(input.budget, budgetState);
      if (budgetCheck.exhausted) {
        result.budget_exhausted = true;
        break;
      }

      const claimedRun = await input.context.repos.workflowRuns.claimRun({
        run_id: run.id,
        worker_id: input.workerId,
        now: input.tick,
        lock_ticks: DEFAULT_WORKFLOW_RUN_LOCK_TICKS
      });
      if (!claimedRun) {
        continue;
      }
      result.advanced_run_count += 1;

      const workflow = getWorkflowDefinitionForRun(input.packRuntime, claimedRun);
      if (!workflow) {
        await input.context.repos.workflowRuns.updateRunStatus({
          run_id: claimedRun.id,
          status: 'failed',
          lock_worker_id: null,
          lock_expires_at: null,
          now: input.tick
        });
        result.failed_run_count += 1;
        continue;
      }

      const runResult = await this.advanceRun({
        ...input,
        run: claimedRun,
        workflow,
        budgetState
      });
      budgetState = runResult.budgetState;
      result.executed_step_count += runResult.executedStepCount;
      result.budget_exhausted = result.budget_exhausted || runResult.budgetExhausted;

      if (runResult.terminalStatus === 'completed') result.completed_run_count += 1;
      if (runResult.terminalStatus === 'failed' || runResult.terminalStatus === 'timed_out') result.failed_run_count += 1;
      if (runResult.terminalStatus === 'narrativized') result.narrativized_run_count += 1;

      if (result.budget_exhausted) {
        break;
      }
    }

    return result;
  }

  private async advanceRun(input: WorkflowAdvanceInput & {
    run: WorkflowRunRecord;
    workflow: WorldPackWorkflowDefinition;
    budgetState: WorkflowBudgetState;
  }): Promise<{
    budgetState: WorkflowBudgetState;
    executedStepCount: number;
    terminalStatus: WorkflowRunRecord['status'] | null;
    budgetExhausted: boolean;
  }> {
    let budgetState = input.budgetState;
    let executedStepCount = 0;

    if (isRunTimedOut(input.run, input.tick)) {
      await input.context.repos.workflowRuns.updateRunStatus({
        run_id: input.run.id,
        status: 'timed_out',
        last_advance_tick: input.tick,
        lock_worker_id: null,
        lock_expires_at: null,
        now: input.tick
      });
      return { budgetState, executedStepCount, terminalStatus: 'timed_out', budgetExhausted: false };
    }

    while (true) {
      const budgetCheck = checkWorkflowBudget(input.budget, budgetState);
      if (budgetCheck.exhausted) {
        await this.releaseRun(input, input.run.status);
        return { budgetState, executedStepCount, terminalStatus: null, budgetExhausted: true };
      }

      const steps = await input.context.repos.workflowSteps.listStepRuns(input.run.id);
      const terminalStatus = resolveRunTerminalStatus(steps);
      if (terminalStatus) {
        await input.context.repos.workflowRuns.updateRunStatus({
          run_id: input.run.id,
          status: terminalStatus,
          last_advance_tick: input.tick,
          lock_worker_id: null,
          lock_expires_at: null,
          now: input.tick
        });
        return { budgetState, executedStepCount, terminalStatus, budgetExhausted: false };
      }

      const readySteps = this.listReadySteps(input.workflow, steps);
      if (readySteps.length === 0) {
        await this.releaseRun(input, 'running');
        return { budgetState, executedStepCount, terminalStatus: null, budgetExhausted: false };
      }

      let progressedThisRound = false;
      const completedStepResults = buildCompletedStepResults(steps);

      for (const { definition, run: stepRun } of readySteps) {
        const stepBudgetCheck = checkWorkflowBudget(input.budget, budgetState);
        if (stepBudgetCheck.exhausted) {
          await this.releaseRun(input, 'running');
          return { budgetState, executedStepCount, terminalStatus: null, budgetExhausted: true };
        }

        if (definition.condition) {
          const conditionResult = evaluateWorkflowCondition({
            condition: definition.condition,
            completedStepResults
          });
          if (conditionResult.outcome === 'false') {
            await input.context.repos.workflowSteps.updateStepStatus({
              step_run_id: stepRun.id,
              status: 'skipped',
              now: input.tick
            });
            progressedThisRound = true;
            continue;
          }
          if (conditionResult.outcome === 'condition_error') {
            const narrativized = await input.context.repos.workflowSteps.narrativizeStep({
              step_run_id: stepRun.id,
              error_json: {
                code: conditionResult.code,
                message: conditionResult.message
              },
              completed_tick: input.tick,
              now: input.tick
            });
            progressedThisRound = narrativized.updated;
            continue;
          }
        }

        await input.context.repos.workflowSteps.updateStepStatus({
          step_run_id: stepRun.id,
          status: 'ready',
          now: input.tick
        });
        const claimedStep = await input.context.repos.workflowSteps.claimStep({
          step_run_id: stepRun.id,
          worker_id: input.workerId,
          now: input.tick,
          lock_ticks: DEFAULT_WORKFLOW_STEP_LOCK_TICKS
        });
        if (!claimedStep) {
          continue;
        }

        const hasOtherActiveWorkflow = await hasActiveWorkflowForActor(input.context, claimedStep.agent_id, {
          excludeWorkflowStepRunIds: [claimedStep.id]
        });
        if (hasOtherActiveWorkflow) {
          await input.context.repos.workflowSteps.releaseStepLock({
            step_run_id: claimedStep.id,
            status: 'ready',
            now: input.tick
          });
          continue;
        }

        const executionOutcome = await this.executeStep({ ...input, stepDefinition: definition, stepRun: claimedStep });
        if (executionOutcome === 'lock_lost') {
          continue;
        }
        executedStepCount += 1;
        budgetState = incrementWorkflowBudgetSteps(budgetState);
        progressedThisRound = true;
      }

      budgetState = incrementWorkflowBudgetRound(budgetState);
      await input.context.repos.workflowRuns.updateRunStatus({
        run_id: input.run.id,
        status: 'running',
        last_advance_tick: input.tick,
        lock_worker_id: input.workerId,
        lock_expires_at: input.tick + DEFAULT_WORKFLOW_RUN_LOCK_TICKS,
        now: input.tick
      });

      if (!progressedThisRound) {
        await this.releaseRun(input, 'running');
        return { budgetState, executedStepCount, terminalStatus: null, budgetExhausted: false };
      }
    }
  }

  private listReadySteps(
    workflow: WorldPackWorkflowDefinition,
    steps: WorkflowStepRunRecord[]
  ): Array<{ definition: WorldPackWorkflowStep; run: WorkflowStepRunRecord }> {
    const stepDefinitionById = mapStepById(workflow);
    const stepRunByStepId = mapStepRunByStepId(steps);
    const readySteps: Array<{ definition: WorldPackWorkflowStep; run: WorkflowStepRunRecord }> = [];

    for (const stepDefinition of workflow.steps) {
      const stepRun = stepRunByStepId.get(stepDefinition.id);
      if (!stepRun) {
        continue;
      }
      if (isStepReady(stepDefinition, stepRun, stepRunByStepId)) {
        readySteps.push({ definition: stepDefinitionById.get(stepDefinition.id) ?? stepDefinition, run: stepRun });
      }
    }

    return readySteps;
  }

  private async executeStep(input: WorkflowAdvanceInput & {
    run: WorkflowRunRecord;
    stepDefinition: WorldPackWorkflowStep;
    stepRun: WorkflowStepRunRecord;
  }): Promise<WorkflowStepExecutionOutcome> {
    try {
      const currentStepRuns = await input.context.repos.workflowSteps.listStepRuns(input.run.id);
      const previousAgentOutput = buildPreviousAgentOutputScope({
        workflowRunId: input.run.id,
        inputStepIds: getStepInputs(input.stepDefinition),
        stepRuns: currentStepRuns
      });
      const requestInput: InferenceRequestInput = {
        agent_id: input.stepDefinition.agent,
        strategy: toStepInferenceStrategy(input.stepDefinition),
        pack_id: input.run.pack_id,
        idempotency_key: input.stepRun.idempotency_key,
        attributes: toStepInferenceAttributes(input.stepDefinition),
        previous_agent_output: previousAgentOutput,
        workflow_source: {
          source_workflow_run_id: input.run.id,
          source_workflow_step_id: input.stepDefinition.id,
          source_step_attempt: input.stepRun.attempt
        }
      };

      const submitResult = await input.inferenceService.submitInferenceJob(requestInput);
      const inferenceResult = await this.resolveSubmittedInferenceResult(input, submitResult, input.stepRun.idempotency_key);

      if (!inferenceResult) {
        const failed = await input.context.repos.workflowSteps.failStep({
          step_run_id: input.stepRun.id,
          error_json: {
            code: 'WORKFLOW_STEP_INFERENCE_NOT_COMPLETED',
            message: 'Workflow step inference job did not produce a completed result',
            stage: 'resolve_submitted_inference_result'
          },
          completed_tick: input.tick,
          now: input.tick,
          worker_id: input.workerId
        });
        return failed.updated ? 'failed' : 'lock_lost';
      }

      const actionIntent = await input.context.repos.inference.findActionIntentByInferenceId(inferenceResult.inference_id);
      const actionIntentIds = actionIntent ? [actionIntent.id] : [];

      const completed = await input.context.repos.workflowSteps.completeStep({
        step_run_id: input.stepRun.id,
        result_json: toWorkflowStepResultJson(inferenceResult, actionIntentIds),
        action_intent_ids: actionIntentIds,
        completed_tick: input.tick,
        now: input.tick,
        worker_id: input.workerId
      });
      return completed.updated ? 'completed' : 'lock_lost';
    } catch (err: unknown) {
      const failed = await input.context.repos.workflowSteps.failStep({
        step_run_id: input.stepRun.id,
        error_json: {
          code: 'WORKFLOW_STEP_EXECUTION_ERROR',
          message: getErrorMessage(err),
          stage: 'execute_step'
        },
        completed_tick: input.tick,
        now: input.tick,
        worker_id: input.workerId
      });
      return failed.updated ? 'failed' : 'lock_lost';
    }
  }

  private async resolveSubmittedInferenceResult(
    input: WorkflowAdvanceInput,
    submitResult: InferenceJobSubmitResult,
    idempotencyKey: string
  ): Promise<InferenceRunResult | null> {
    if (submitResult.result) {
      return submitResult.result;
    }

    const job = await input.context.repos.inference.getByIdempotencyKey(idempotencyKey);
    if (!job) {
      return null;
    }

    const claimedJob = await input.context.repos.inference.claim(job.id, input.workerId);
    if (!claimedJob) {
      return null;
    }

    return input.inferenceService.executeDecisionJob(claimedJob.id, { workerId: input.workerId });
  }

  private async releaseRun(
    input: WorkflowAdvanceInput & { run: WorkflowRunRecord },
    status: WorkflowRunRecord['status']
  ): Promise<void> {
    await input.context.repos.workflowRuns.updateRunStatus({
      run_id: input.run.id,
      status,
      last_advance_tick: input.tick,
      lock_worker_id: null,
      lock_expires_at: null,
      now: input.tick
    });
  }
}

export const createWorkflowEngine = (): WorkflowEngine => new WorkflowEngine();
