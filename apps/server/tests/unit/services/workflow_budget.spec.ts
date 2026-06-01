import { describe, expect, it } from 'vitest';

import {
  checkWorkflowBudget,
  createWorkflowBudgetState,
  incrementWorkflowBudgetRound,
  incrementWorkflowBudgetSteps} from '../../../src/app/services/workflow/workflow_budget.js';

describe('createWorkflowBudgetState', () => {
  it('creates state with default startedAtMs', () => {
    const before = Date.now();
    const state = createWorkflowBudgetState();
    const after = Date.now();
    expect(state.startedAtMs).toBeGreaterThanOrEqual(before);
    expect(state.startedAtMs).toBeLessThanOrEqual(after);
    expect(state.completedRounds).toBe(0);
    expect(state.executedSteps).toBe(0);
  });

  it('creates state with custom startedAtMs', () => {
    const state = createWorkflowBudgetState(1000);
    expect(state.startedAtMs).toBe(1000);
    expect(state.completedRounds).toBe(0);
    expect(state.executedSteps).toBe(0);
  });
});

describe('incrementWorkflowBudgetRound', () => {
  it('increments completedRounds by 1', () => {
    const state = createWorkflowBudgetState(1000);
    const next = incrementWorkflowBudgetRound(state);
    expect(next.completedRounds).toBe(1);
    expect(next.executedSteps).toBe(0);
    expect(next.startedAtMs).toBe(1000);
  });

  it('does not mutate original state', () => {
    const state = createWorkflowBudgetState(1000);
    incrementWorkflowBudgetRound(state);
    expect(state.completedRounds).toBe(0);
  });
});

describe('incrementWorkflowBudgetSteps', () => {
  it('increments executedSteps by 1 by default', () => {
    const state = createWorkflowBudgetState(1000);
    const next = incrementWorkflowBudgetSteps(state);
    expect(next.executedSteps).toBe(1);
  });

  it('increments executedSteps by custom count', () => {
    const state = createWorkflowBudgetState(1000);
    const next = incrementWorkflowBudgetSteps(state, 5);
    expect(next.executedSteps).toBe(5);
  });

  it('does not mutate original state', () => {
    const state = createWorkflowBudgetState(1000);
    incrementWorkflowBudgetSteps(state, 3);
    expect(state.executedSteps).toBe(0);
  });
});

describe('checkWorkflowBudget', () => {
  const budget = {
    max_rounds_per_tick: 3,
    max_steps_per_tick: 10,
    max_wall_time_ms_per_tick: 5000
  };

  it('returns not exhausted when all limits are within bounds', () => {
    const state = { startedAtMs: 1000, completedRounds: 1, executedSteps: 5 };
    const result = checkWorkflowBudget(budget, state, 2000);
    expect(result.exhausted).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('returns exhausted when max_rounds_per_tick reached', () => {
    const state = { startedAtMs: 1000, completedRounds: 3, executedSteps: 0 };
    const result = checkWorkflowBudget(budget, state, 2000);
    expect(result.exhausted).toBe(true);
    expect(result.reason).toBe('max_rounds_per_tick');
  });

  it('returns exhausted when max_steps_per_tick reached', () => {
    const state = { startedAtMs: 1000, completedRounds: 0, executedSteps: 10 };
    const result = checkWorkflowBudget(budget, state, 2000);
    expect(result.exhausted).toBe(true);
    expect(result.reason).toBe('max_steps_per_tick');
  });

  it('returns exhausted when max_wall_time_ms_per_tick reached', () => {
    const state = { startedAtMs: 1000, completedRounds: 0, executedSteps: 0 };
    const result = checkWorkflowBudget(budget, state, 6001);
    expect(result.exhausted).toBe(true);
    expect(result.reason).toBe('max_wall_time_ms_per_tick');
  });

  it('prioritizes max_rounds check over max_steps', () => {
    const state = { startedAtMs: 1000, completedRounds: 3, executedSteps: 10 };
    const result = checkWorkflowBudget(budget, state, 2000);
    expect(result.exhausted).toBe(true);
    expect(result.reason).toBe('max_rounds_per_tick');
  });

  it('prioritizes max_steps check over wall_time', () => {
    const state = { startedAtMs: 1000, completedRounds: 0, executedSteps: 10 };
    const result = checkWorkflowBudget(budget, state, 6001);
    expect(result.exhausted).toBe(true);
    expect(result.reason).toBe('max_steps_per_tick');
  });
});
