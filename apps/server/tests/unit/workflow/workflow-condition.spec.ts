import { describe, expect, it } from 'vitest';

import { evaluateWorkflowCondition } from '../../../src/app/services/workflow/workflow_condition.js';
import type { WorkflowStepResultJson } from '../../../src/app/services/workflow/workflow_types.js';

const reviewResult: WorkflowStepResultJson = {
  reasoning: 'review reasoning',
  decision_summary: 'approved',
  grounding_result: {
    type: 'exact',
    semantic_intent: 'approve_proposal'
  },
  inference_id: 'inf-review',
  action_intent_ids: ['intent-review']
};

const completedStepResults = new Map<string, WorkflowStepResultJson>([
  ['review', reviewResult]
]);

describe('workflow condition evaluator', () => {
  it('evaluates eq and neq against completed step result scalar fields', () => {
    expect(evaluateWorkflowCondition({
      condition: { field: 'review.grounding_result.type', op: 'eq', value: 'exact' },
      completedStepResults
    })).toEqual({ outcome: 'true' });

    expect(evaluateWorkflowCondition({
      condition: { field: 'review.grounding_result.type', op: 'neq', value: 'blocked' },
      completedStepResults
    })).toEqual({ outcome: 'true' });

    expect(evaluateWorkflowCondition({
      condition: { field: 'review.grounding_result.type', op: 'neq', value: 'exact' },
      completedStepResults
    })).toEqual({ outcome: 'false' });
  });

  it('returns condition_error for missing fields instead of treating neq as success', () => {
    expect(evaluateWorkflowCondition({
      condition: { field: 'review.grounding_result.missing', op: 'neq', value: 'exact' },
      completedStepResults
    })).toMatchObject({
      outcome: 'condition_error',
      code: 'WORKFLOW_CONDITION_FIELD_MISSING'
    });
  });

  it('returns condition_error for missing completed step result', () => {
    expect(evaluateWorkflowCondition({
      condition: { field: 'draft.grounding_result.type', op: 'eq', value: 'exact' },
      completedStepResults
    })).toMatchObject({
      outcome: 'condition_error',
      code: 'WORKFLOW_CONDITION_STEP_RESULT_MISSING'
    });
  });

  it('returns condition_error for invalid field path', () => {
    expect(evaluateWorkflowCondition({
      condition: { field: 'review', op: 'eq', value: 'exact' },
      completedStepResults
    })).toMatchObject({
      outcome: 'condition_error',
      code: 'WORKFLOW_CONDITION_INVALID_FIELD'
    });
  });

  it('returns condition_error for non-scalar resolved values', () => {
    expect(evaluateWorkflowCondition({
      condition: { field: 'review.grounding_result', op: 'eq', value: 'exact' },
      completedStepResults
    })).toMatchObject({
      outcome: 'condition_error',
      code: 'WORKFLOW_CONDITION_NON_SCALAR_VALUE'
    });
  });
});
