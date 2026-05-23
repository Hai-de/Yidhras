import type { WorkflowAdvanceBudget } from './workflow_types.js';

export interface WorkflowBudgetState {
  readonly startedAtMs: number;
  readonly completedRounds: number;
  readonly executedSteps: number;
}

export interface WorkflowBudgetCheckResult {
  exhausted: boolean;
  reason: 'max_rounds_per_tick' | 'max_steps_per_tick' | 'max_wall_time_ms_per_tick' | null;
}

export const createWorkflowBudgetState = (startedAtMs = Date.now()): WorkflowBudgetState => ({
  startedAtMs,
  completedRounds: 0,
  executedSteps: 0
});

export const incrementWorkflowBudgetRound = (state: WorkflowBudgetState): WorkflowBudgetState => ({
  ...state,
  completedRounds: state.completedRounds + 1
});

export const incrementWorkflowBudgetSteps = (state: WorkflowBudgetState, stepCount = 1): WorkflowBudgetState => ({
  ...state,
  executedSteps: state.executedSteps + stepCount
});

export const checkWorkflowBudget = (
  budget: WorkflowAdvanceBudget,
  state: WorkflowBudgetState,
  nowMs = Date.now()
): WorkflowBudgetCheckResult => {
  if (state.completedRounds >= budget.max_rounds_per_tick) {
    return { exhausted: true, reason: 'max_rounds_per_tick' };
  }
  if (state.executedSteps >= budget.max_steps_per_tick) {
    return { exhausted: true, reason: 'max_steps_per_tick' };
  }
  if (nowMs - state.startedAtMs >= budget.max_wall_time_ms_per_tick) {
    return { exhausted: true, reason: 'max_wall_time_ms_per_tick' };
  }

  return { exhausted: false, reason: null };
};
