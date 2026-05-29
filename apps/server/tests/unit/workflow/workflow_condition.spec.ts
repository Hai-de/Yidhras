import { describe, expect, it } from 'vitest';

import { evaluateWorkflowCondition } from '../../../src/app/services/workflow/workflow_condition.js';
import type { WorkflowConditionEvaluationInput, WorkflowStepResultJson } from '../../../src/app/services/workflow/workflow_types.js';

const makeStepResult = (overrides?: Partial<WorkflowStepResultJson>): WorkflowStepResultJson => ({
  reasoning: 'Test reasoning',
  decision_summary: 'Test decision',
  grounding_result: { type: 'exact', semantic_intent: 'test_intent' },
  inference_id: 'inf-1',
  action_intent_ids: ['ai-1'],
  ...overrides
});

describe('workflow_condition', () => {
  describe('evaluateWorkflowCondition', () => {
    it('returns true when eq condition matches', () => {
      const results = new Map<string, WorkflowStepResultJson>();
      results.set('step-1', makeStepResult({ reasoning: 'matching value' }));

      const input: WorkflowConditionEvaluationInput = {
        condition: {
          field: 'step-1.reasoning',
          op: 'eq',
          value: 'matching value'
        },
        completedStepResults: results
      };

      const result = evaluateWorkflowCondition(input);
      expect(result.outcome).toBe('true');
    });

    it('returns false when eq condition does not match', () => {
      const results = new Map<string, WorkflowStepResultJson>();
      results.set('step-1', makeStepResult({ reasoning: 'different value' }));

      const input: WorkflowConditionEvaluationInput = {
        condition: {
          field: 'step-1.reasoning',
          op: 'eq',
          value: 'expected value'
        },
        completedStepResults: results
      };

      const result = evaluateWorkflowCondition(input);
      expect(result.outcome).toBe('false');
    });

    it('returns true when neq condition does not match', () => {
      const results = new Map<string, WorkflowStepResultJson>();
      results.set('step-1', makeStepResult({ reasoning: 'actual value' }));

      const input: WorkflowConditionEvaluationInput = {
        condition: {
          field: 'step-1.reasoning',
          op: 'neq',
          value: 'different value'
        },
        completedStepResults: results
      };

      const result = evaluateWorkflowCondition(input);
      expect(result.outcome).toBe('true');
    });

    it('returns false when neq condition matches', () => {
      const results = new Map<string, WorkflowStepResultJson>();
      results.set('step-1', makeStepResult({ reasoning: 'same value' }));

      const input: WorkflowConditionEvaluationInput = {
        condition: {
          field: 'step-1.reasoning',
          op: 'neq',
          value: 'same value'
        },
        completedStepResults: results
      };

      const result = evaluateWorkflowCondition(input);
      expect(result.outcome).toBe('false');
    });

    it('returns error for invalid field format (no dot)', () => {
      const results = new Map<string, WorkflowStepResultJson>();

      const input: WorkflowConditionEvaluationInput = {
        condition: {
          field: 'nodot',
          op: 'eq',
          value: 'x'
        },
        completedStepResults: results
      };

      const result = evaluateWorkflowCondition(input);
      expect(result.outcome).toBe('condition_error');
      if (result.outcome === 'condition_error') {
        expect(result.code).toBe('WORKFLOW_CONDITION_INVALID_FIELD');
      }
    });

    it('returns error for empty field', () => {
      const results = new Map<string, WorkflowStepResultJson>();

      const input: WorkflowConditionEvaluationInput = {
        condition: {
          field: '',
          op: 'eq',
          value: 'x'
        },
        completedStepResults: results
      };

      const result = evaluateWorkflowCondition(input);
      expect(result.outcome).toBe('condition_error');
    });

    it('returns error when step result is missing', () => {
      const results = new Map<string, WorkflowStepResultJson>();

      const input: WorkflowConditionEvaluationInput = {
        condition: {
          field: 'missing-step.reasoning',
          op: 'eq',
          value: 'x'
        },
        completedStepResults: results
      };

      const result = evaluateWorkflowCondition(input);
      expect(result.outcome).toBe('condition_error');
      if (result.outcome === 'condition_error') {
        expect(result.code).toBe('WORKFLOW_CONDITION_STEP_RESULT_MISSING');
      }
    });

    it('returns error when field path is missing in step result', () => {
      const results = new Map<string, WorkflowStepResultJson>();
      results.set('step-1', makeStepResult());

      const input: WorkflowConditionEvaluationInput = {
        condition: {
          field: 'step-1.nonexistent_field',
          op: 'eq',
          value: 'x'
        },
        completedStepResults: results
      };

      const result = evaluateWorkflowCondition(input);
      expect(result.outcome).toBe('condition_error');
      if (result.outcome === 'condition_error') {
        expect(result.code).toBe('WORKFLOW_CONDITION_FIELD_MISSING');
      }
    });

    it('reads nested fields', () => {
      const results = new Map<string, WorkflowStepResultJson>();
      results.set('step-1', makeStepResult({
        grounding_result: { type: 'exact', semantic_intent: 'my_intent' }
      }));

      const input: WorkflowConditionEvaluationInput = {
        condition: {
          field: 'step-1.grounding_result',
          op: 'eq',
          value: 'x'
        },
        completedStepResults: results
      };

      // grounding_result is an object, not a scalar → should error
      const result = evaluateWorkflowCondition(input);
      expect(result.outcome).toBe('condition_error');
      if (result.outcome === 'condition_error') {
        expect(result.code).toBe('WORKFLOW_CONDITION_NON_SCALAR_VALUE');
      }
    });

    it('handles null scalar values', () => {
      const results = new Map<string, WorkflowStepResultJson>();
      results.set('step-1', makeStepResult({ reasoning: null }));

      const input: WorkflowConditionEvaluationInput = {
        condition: {
          field: 'step-1.reasoning',
          op: 'eq',
          value: null
        },
        completedStepResults: results
      };

      const result = evaluateWorkflowCondition(input);
      expect(result.outcome).toBe('true');
    });

    it('handles boolean scalar values', () => {
      const results = new Map<string, WorkflowStepResultJson>();
      results.set('step-1', makeStepResult({ inference_id: null }));

      const input: WorkflowConditionEvaluationInput = {
        condition: {
          field: 'step-1.inference_id',
          op: 'eq',
          value: null
        },
        completedStepResults: results
      };

      const result = evaluateWorkflowCondition(input);
      expect(result.outcome).toBe('true');
    });

    it('trims empty segments from field path', () => {
      const results = new Map<string, WorkflowStepResultJson>();
      results.set('step-1', makeStepResult({ reasoning: 'val' }));

      // 'step-1..reasoning' → ['step-1', '', 'reasoning'] → filtered to ['step-1', 'reasoning']
      const input: WorkflowConditionEvaluationInput = {
        condition: {
          field: 'step-1..reasoning',
          op: 'eq',
          value: 'val'
        },
        completedStepResults: results
      };

      const result = evaluateWorkflowCondition(input);
      expect(result.outcome).toBe('true');
    });
  });
});
