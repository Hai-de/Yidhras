import { describe, expect, it } from 'vitest';

import {
  checkWorkflowBudget,
  createWorkflowBudgetState,
  incrementWorkflowBudgetRound,
  incrementWorkflowBudgetSteps
} from '../../../src/app/services/workflow/workflow_budget.js';

describe('workflow budget helpers', () => {
  it('reports no exhaustion while under all limits', () => {
    const state = createWorkflowBudgetState(1000);
    expect(checkWorkflowBudget({
      max_rounds_per_tick: 2,
      max_steps_per_tick: 3,
      max_wall_time_ms_per_tick: 100
    }, state, 1050)).toEqual({ exhausted: false, reason: null });
  });

  it('exhausts by rounds', () => {
    const state = incrementWorkflowBudgetRound(createWorkflowBudgetState(1000));
    expect(checkWorkflowBudget({
      max_rounds_per_tick: 1,
      max_steps_per_tick: 10,
      max_wall_time_ms_per_tick: 100
    }, state, 1001)).toEqual({ exhausted: true, reason: 'max_rounds_per_tick' });
  });

  it('exhausts by steps', () => {
    const state = incrementWorkflowBudgetSteps(createWorkflowBudgetState(1000), 2);
    expect(checkWorkflowBudget({
      max_rounds_per_tick: 10,
      max_steps_per_tick: 2,
      max_wall_time_ms_per_tick: 100
    }, state, 1001)).toEqual({ exhausted: true, reason: 'max_steps_per_tick' });
  });

  it('exhausts by wall time', () => {
    const state = createWorkflowBudgetState(1000);
    expect(checkWorkflowBudget({
      max_rounds_per_tick: 10,
      max_steps_per_tick: 10,
      max_wall_time_ms_per_tick: 50
    }, state, 1050)).toEqual({ exhausted: true, reason: 'max_wall_time_ms_per_tick' });
  });
});
