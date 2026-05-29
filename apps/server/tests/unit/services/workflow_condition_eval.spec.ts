import { describe, expect, it } from 'vitest';

import { evaluateWorkflowCondition } from '../../../src/app/services/workflow/workflow_condition.js';

describe('evaluateWorkflowCondition', () => {
  const makeStepResult = (overrides: Record<string, unknown> = {}) => ({
    reasoning: 'test reasoning',
    decision_summary: 'test decision',
    grounding_result: { type: 'exact' as const, semantic_intent: 'test intent' },
    inference_id: 'inf-1',
    action_intent_ids: [],
    ...overrides
  });

  describe('field parsing', () => {
    it('returns error for empty field', () => {
      const result = evaluateWorkflowCondition({
        condition: { field: '', op: 'eq', value: 'test' },
        completedStepResults: new Map()
      });

      expect(result).toEqual({
        outcome: 'condition_error',
        code: 'WORKFLOW_CONDITION_INVALID_FIELD',
        message: 'condition field must use <step_id>.<path...> format'
      });
    });

    it('returns error for field with only step_id (no path)', () => {
      const result = evaluateWorkflowCondition({
        condition: { field: 'step-A', op: 'eq', value: 'test' },
        completedStepResults: new Map()
      });

      expect(result).toEqual({
        outcome: 'condition_error',
        code: 'WORKFLOW_CONDITION_INVALID_FIELD',
        message: 'condition field must use <step_id>.<path...> format'
      });
    });

    it('returns error for missing step result', () => {
      const result = evaluateWorkflowCondition({
        condition: { field: 'step-A.reasoning', op: 'eq', value: 'test' },
        completedStepResults: new Map()
      });

      expect(result).toEqual({
        outcome: 'condition_error',
        code: 'WORKFLOW_CONDITION_STEP_RESULT_MISSING',
        message: 'condition references step "step-A" without a completed result'
      });
    });
  });

  describe('eq operator', () => {
    it('returns true when values are equal', () => {
      const results = new Map([['step-A', makeStepResult({ reasoning: 'matching' })]]);
      const result = evaluateWorkflowCondition({
        condition: { field: 'step-A.reasoning', op: 'eq', value: 'matching' },
        completedStepResults: results
      });

      expect(result).toEqual({ outcome: 'true' });
    });

    it('returns false when values are not equal', () => {
      const results = new Map([['step-A', makeStepResult({ reasoning: 'other' })]]);
      const result = evaluateWorkflowCondition({
        condition: { field: 'step-A.reasoning', op: 'eq', value: 'matching' },
        completedStepResults: results
      });

      expect(result).toEqual({ outcome: 'false' });
    });

    it('compares null values', () => {
      const results = new Map([['step-A', makeStepResult({ reasoning: null })]]);
      const result = evaluateWorkflowCondition({
        condition: { field: 'step-A.reasoning', op: 'eq', value: null },
        completedStepResults: results
      });

      expect(result).toEqual({ outcome: 'true' });
    });
  });

  describe('neq operator', () => {
    it('returns true when values are not equal', () => {
      const results = new Map([['step-A', makeStepResult({ reasoning: 'other' })]]);
      const result = evaluateWorkflowCondition({
        condition: { field: 'step-A.reasoning', op: 'neq', value: 'matching' },
        completedStepResults: results
      });

      expect(result).toEqual({ outcome: 'true' });
    });

    it('returns false when values are equal', () => {
      const results = new Map([['step-A', makeStepResult({ reasoning: 'matching' })]]);
      const result = evaluateWorkflowCondition({
        condition: { field: 'step-A.reasoning', op: 'neq', value: 'matching' },
        completedStepResults: results
      });

      expect(result).toEqual({ outcome: 'false' });
    });
  });

  describe('nested path traversal', () => {
    it('reads nested object fields', () => {
      const results = new Map([['step-A', makeStepResult({
        grounding_result: { type: 'exact', semantic_intent: 'found it' }
      })]]);
      const result = evaluateWorkflowCondition({
        condition: { field: 'step-A.grounding_result.type', op: 'eq', value: 'exact' },
        completedStepResults: results
      });

      expect(result).toEqual({ outcome: 'true' });
    });

    it('returns error for missing nested segment', () => {
      const results = new Map([['step-A', makeStepResult()]]);
      const result = evaluateWorkflowCondition({
        condition: { field: 'step-A.nonexistent.field', op: 'eq', value: 'test' },
        completedStepResults: results
      });

      expect(result).toEqual({
        outcome: 'condition_error',
        code: 'WORKFLOW_CONDITION_FIELD_MISSING',
        message: 'condition field path is missing segment "nonexistent"'
      });
    });

    it('returns error when path goes through non-object', () => {
      const results = new Map([['step-A', makeStepResult({ reasoning: 'string value' })]]);
      const result = evaluateWorkflowCondition({
        condition: { field: 'step-A.reasoning.deeper', op: 'eq', value: 'test' },
        completedStepResults: results
      });

      expect(result).toEqual({
        outcome: 'condition_error',
        code: 'WORKFLOW_CONDITION_NON_OBJECT_PATH',
        message: expect.stringContaining('cannot be read from a non-object value')
      });
    });

    it('returns error for non-scalar terminal value', () => {
      const results = new Map([['step-A', makeStepResult({
        grounding_result: { type: 'exact', semantic_intent: 'test' }
      })]]);
      const result = evaluateWorkflowCondition({
        condition: { field: 'step-A.grounding_result', op: 'eq', value: 'test' },
        completedStepResults: results
      });

      expect(result).toEqual({
        outcome: 'condition_error',
        code: 'WORKFLOW_CONDITION_NON_SCALAR_VALUE',
        message: 'condition field value must be a JSON scalar'
      });
    });
  });

  describe('boolean and number comparisons', () => {
    it('compares boolean values with eq', () => {
      const results = new Map([['step-A', makeStepResult({ reasoning: true })]]);
      // This is testing field reads, not reasoning which is string - using action_intent_ids
      const result = evaluateWorkflowCondition({
        condition: { field: 'step-A.reasoning', op: 'eq', value: true },
        completedStepResults: results
      });

      expect(result).toEqual({ outcome: 'true' });
    });

    it('compares number values', () => {
      const results = new Map([['step-A', makeStepResult({ inference_id: 42 })]]);
      const result = evaluateWorkflowCondition({
        condition: { field: 'step-A.inference_id', op: 'eq', value: 42 },
        completedStepResults: results
      });

      expect(result).toEqual({ outcome: 'true' });
    });
  });

  describe('Object.is semantics', () => {
    it('distinguishes -0 and +0', () => {
      const results = new Map([['step-A', makeStepResult({ inference_id: 0 })]]);
      const result = evaluateWorkflowCondition({
        condition: { field: 'step-A.inference_id', op: 'eq', value: -0 },
        completedStepResults: results
      });

      // Object.is(0, -0) is false
      expect(result).toEqual({ outcome: 'false' });
    });
  });
});
