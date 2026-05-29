import { describe, expect, it } from 'vitest';

import {
  buildPreviousAgentOutputScope,
  buildPreviousAgentOutputTemplateScope,
  hasAllRequiredPreviousAgentOutputs
} from '../../../src/app/services/workflow/workflow_previous_output.js';
import type { WorkflowStepRunRecord } from '../../../src/app/services/workflow/workflow_types.js';

describe('workflow_previous_output', () => {
  const makeStepRun = (overrides: Partial<WorkflowStepRunRecord> = {}): WorkflowStepRunRecord => ({
    id: 'sr-1',
    workflow_run_id: 'run-1',
    step_id: 'step-A',
    agent_id: 'agent-1',
    partition_id: 0,
    status: 'completed',
    dependency_step_ids: [],
    input_step_ids: [],
    result_json: {
      reasoning: 'because of X',
      decision_summary: 'did Y',
      grounding_result: { type: 'exact' as const, semantic_intent: 'test intent' },
      inference_id: 'inf-1',
      action_intent_ids: []
    },
    error_json: null,
    action_intent_ids: [],
    attempt: 1,
    started_tick: 1n,
    completed_tick: 2n,
    lock_worker_id: null,
    lock_expires_at: null,
    idempotency_key: 'idem-1',
    ...overrides
  });

  describe('buildPreviousAgentOutputScope', () => {
    it('returns empty object when inputStepIds is empty', () => {
      const result = buildPreviousAgentOutputScope({
        workflowRunId: 'run-1',
        inputStepIds: [],
        stepRuns: [makeStepRun()]
      });

      expect(result).toEqual({});
    });

    it('maps completed step runs to output scope', () => {
      const result = buildPreviousAgentOutputScope({
        workflowRunId: 'run-1',
        inputStepIds: ['step-A'],
        stepRuns: [makeStepRun()]
      });

      expect(result['step-A']).toEqual({
        source_type: 'previous_agent_output',
        workflow_run_id: 'run-1',
        step_id: 'step-A',
        agent_id: 'agent-1',
        content: {
          reasoning: 'because of X',
          decision_summary: 'did Y',
          grounding_result_type: 'exact',
          semantic_intent: 'test intent'
        }
      });
    });

    it('skips non-completed step runs', () => {
      const result = buildPreviousAgentOutputScope({
        workflowRunId: 'run-1',
        inputStepIds: ['step-A'],
        stepRuns: [makeStepRun({ status: 'running' })]
      });

      expect(result).toEqual({});
    });

    it('skips step runs without result_json', () => {
      const result = buildPreviousAgentOutputScope({
        workflowRunId: 'run-1',
        inputStepIds: ['step-A'],
        stepRuns: [makeStepRun({ result_json: null })]
      });

      expect(result).toEqual({});
    });

    it('skips step runs not present in stepRuns array', () => {
      const result = buildPreviousAgentOutputScope({
        workflowRunId: 'run-1',
        inputStepIds: ['step-missing'],
        stepRuns: [makeStepRun()]
      });

      expect(result).toEqual({});
    });

    it('handles multiple step runs', () => {
      const stepA = makeStepRun({ step_id: 'step-A', agent_id: 'agent-1' });
      const stepB = makeStepRun({
        step_id: 'step-B',
        agent_id: 'agent-2',
        result_json: {
          reasoning: 'reason B',
          decision_summary: 'decision B',
          grounding_result: { type: 'translated' as const, semantic_intent: 'intent B' },
          inference_id: 'inf-2',
          action_intent_ids: []
        }
      });

      const result = buildPreviousAgentOutputScope({
        workflowRunId: 'run-1',
        inputStepIds: ['step-A', 'step-B'],
        stepRuns: [stepA, stepB]
      });

      expect(Object.keys(result)).toEqual(['step-A', 'step-B']);
      expect(result['step-A'].agent_id).toBe('agent-1');
      expect(result['step-B'].agent_id).toBe('agent-2');
    });
  });

  describe('buildPreviousAgentOutputTemplateScope', () => {
    it('returns empty object for null input', () => {
      expect(buildPreviousAgentOutputTemplateScope(null)).toEqual({});
    });

    it('returns empty object for undefined input', () => {
      expect(buildPreviousAgentOutputTemplateScope(undefined)).toEqual({});
    });

    it('maps output scope to template scope with correct fields', () => {
      const scope = buildPreviousAgentOutputScope({
        workflowRunId: 'run-1',
        inputStepIds: ['step-A'],
        stepRuns: [makeStepRun()]
      });

      const template = buildPreviousAgentOutputTemplateScope(scope);

      expect(template['step-A']).toEqual({
        reasoning: 'because of X',
        decision_summary: 'did Y',
        grounding_result_type: 'exact',
        semantic_intent: 'test intent',
        source_type: 'previous_agent_output',
        workflow_run_id: 'run-1',
        step_id: 'step-A',
        agent_id: 'agent-1'
      });
    });

    it('preserves all step entries', () => {
      const scope: Record<string, {
        source_type: 'previous_agent_output';
        workflow_run_id: string;
        step_id: string;
        agent_id: string;
        content: {
          reasoning: string | null;
          decision_summary: string | null;
          grounding_result_type: 'exact' | 'translated' | 'narrativized' | 'blocked';
          semantic_intent: string | null;
        };
      }> = {
        'step-A': {
          source_type: 'previous_agent_output',
          workflow_run_id: 'run-1',
          step_id: 'step-A',
          agent_id: 'agent-1',
          content: {
            reasoning: 'r1',
            decision_summary: 'd1',
            grounding_result_type: 'exact',
            semantic_intent: 'i1'
          }
        },
        'step-B': {
          source_type: 'previous_agent_output',
          workflow_run_id: 'run-1',
          step_id: 'step-B',
          agent_id: 'agent-2',
          content: {
            reasoning: 'r2',
            decision_summary: 'd2',
            grounding_result_type: 'translated',
            semantic_intent: 'i2'
          }
        }
      };

      const template = buildPreviousAgentOutputTemplateScope(scope);
      expect(Object.keys(template)).toEqual(['step-A', 'step-B']);
    });
  });

  describe('hasAllRequiredPreviousAgentOutputs', () => {
    it('returns true when all required steps have completed results', () => {
      const result = hasAllRequiredPreviousAgentOutputs({
        inputStepIds: ['step-A'],
        stepRuns: [makeStepRun()]
      });

      expect(result).toBe(true);
    });

    it('returns false when a required step is missing', () => {
      const result = hasAllRequiredPreviousAgentOutputs({
        inputStepIds: ['step-A', 'step-missing'],
        stepRuns: [makeStepRun()]
      });

      expect(result).toBe(false);
    });

    it('returns false when a required step has no result_json', () => {
      const result = hasAllRequiredPreviousAgentOutputs({
        inputStepIds: ['step-A'],
        stepRuns: [makeStepRun({ result_json: null })]
      });

      expect(result).toBe(false);
    });

    it('returns false when a required step is not completed', () => {
      const result = hasAllRequiredPreviousAgentOutputs({
        inputStepIds: ['step-A'],
        stepRuns: [makeStepRun({ status: 'running' })]
      });

      expect(result).toBe(false);
    });

    it('returns true for empty inputStepIds', () => {
      const result = hasAllRequiredPreviousAgentOutputs({
        inputStepIds: [],
        stepRuns: []
      });

      expect(result).toBe(true);
    });
  });
});
