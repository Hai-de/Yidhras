import { describe, expect, it } from 'vitest';

import {
  createWorkflowBudgetState,
  incrementWorkflowBudgetRound,
  incrementWorkflowBudgetSteps,
  checkWorkflowBudget
} from '../../../src/app/services/workflow/workflow_budget.js';
import type { WorkflowAdvanceBudget } from '../../../src/app/services/workflow/workflow_types.js';

const makeBudget = (overrides?: Partial<WorkflowAdvanceBudget>): WorkflowAdvanceBudget => ({
  max_rounds_per_tick: 10,
  max_steps_per_tick: 50,
  max_wall_time_ms_per_tick: 30000,
  ...overrides
});

describe('workflow_budget', () => {
  describe('createWorkflowBudgetState', () => {
    it('creates initial state with zero counters', () => {
      const state = createWorkflowBudgetState(1000);
      expect(state.startedAtMs).toBe(1000);
      expect(state.completedRounds).toBe(0);
      expect(state.executedSteps).toBe(0);
    });

    it('uses provided start time', () => {
      const state = createWorkflowBudgetState(5000);
      expect(state.startedAtMs).toBe(5000);
    });
  });

  describe('incrementWorkflowBudgetRound', () => {
    it('increments completed rounds by 1', () => {
      const state = createWorkflowBudgetState(1000);
      const updated = incrementWorkflowBudgetRound(state);
      expect(updated.completedRounds).toBe(1);
      expect(updated.executedSteps).toBe(0);
      expect(updated.startedAtMs).toBe(1000);
    });

    it('preserves other fields', () => {
      const state = { startedAtMs: 2000, completedRounds: 5, executedSteps: 10 };
      const updated = incrementWorkflowBudgetRound(state);
      expect(updated.completedRounds).toBe(6);
      expect(updated.executedSteps).toBe(10);
      expect(updated.startedAtMs).toBe(2000);
    });
  });

  describe('incrementWorkflowBudgetSteps', () => {
    it('increments executed steps by 1 by default', () => {
      const state = createWorkflowBudgetState(1000);
      const updated = incrementWorkflowBudgetSteps(state);
      expect(updated.executedSteps).toBe(1);
      expect(updated.completedRounds).toBe(0);
    });

    it('increments by custom count', () => {
      const state = createWorkflowBudgetState(1000);
      const updated = incrementWorkflowBudgetSteps(state, 5);
      expect(updated.executedSteps).toBe(5);
    });

    it('preserves other fields', () => {
      const state = { startedAtMs: 2000, completedRounds: 3, executedSteps: 7 };
      const updated = incrementWorkflowBudgetSteps(state, 2);
      expect(updated.executedSteps).toBe(9);
      expect(updated.completedRounds).toBe(3);
      expect(updated.startedAtMs).toBe(2000);
    });
  });

  describe('checkWorkflowBudget', () => {
    it('returns not exhausted when within limits', () => {
      const budget = makeBudget();
      const state = createWorkflowBudgetState(1000);
      const result = checkWorkflowBudget(budget, state, 1500);
      expect(result.exhausted).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('detects max_rounds_per_tick exhaustion', () => {
      const budget = makeBudget({ max_rounds_per_tick: 3 });
      const state = { startedAtMs: 1000, completedRounds: 3, executedSteps: 0 };
      const result = checkWorkflowBudget(budget, state, 1500);
      expect(result.exhausted).toBe(true);
      expect(result.reason).toBe('max_rounds_per_tick');
    });

    it('detects max_steps_per_tick exhaustion', () => {
      const budget = makeBudget({ max_steps_per_tick: 10 });
      const state = { startedAtMs: 1000, completedRounds: 0, executedSteps: 10 };
      const result = checkWorkflowBudget(budget, state, 1500);
      expect(result.exhausted).toBe(true);
      expect(result.reason).toBe('max_steps_per_tick');
    });

    it('detects max_wall_time_ms_per_tick exhaustion', () => {
      const budget = makeBudget({ max_wall_time_ms_per_tick: 5000 });
      const state = { startedAtMs: 1000, completedRounds: 0, executedSteps: 0 };
      const result = checkWorkflowBudget(budget, state, 6000);
      expect(result.exhausted).toBe(true);
      expect(result.reason).toBe('max_wall_time_ms_per_tick');
    });

    it('checks round limit before step limit', () => {
      const budget = makeBudget({ max_rounds_per_tick: 1, max_steps_per_tick: 1 });
      const state = { startedAtMs: 1000, completedRounds: 1, executedSteps: 1 };
      const result = checkWorkflowBudget(budget, state, 1100);
      expect(result.exhausted).toBe(true);
      expect(result.reason).toBe('max_rounds_per_tick');
    });

    it('returns not exhausted at boundary (one less than limit)', () => {
      const budget = makeBudget({ max_rounds_per_tick: 5 });
      const state = { startedAtMs: 1000, completedRounds: 4, executedSteps: 0 };
      const result = checkWorkflowBudget(budget, state, 1100);
      expect(result.exhausted).toBe(false);
    });

    it('returns exhausted at exact boundary', () => {
      const budget = makeBudget({ max_rounds_per_tick: 5 });
      const state = { startedAtMs: 1000, completedRounds: 5, executedSteps: 0 };
      const result = checkWorkflowBudget(budget, state, 1100);
      expect(result.exhausted).toBe(true);
      expect(result.reason).toBe('max_rounds_per_tick');
    });
  });
});
