import { describe, expect, it } from 'vitest';

import {
  buildPreviousAgentOutputScope,
  buildPreviousAgentOutputTemplateScope,
  hasAllRequiredPreviousAgentOutputs
} from '../../../src/app/services/workflow/workflow_previous_output.js';

const makeStepRun = (overrides: Partial<WorkflowStepRunRecord>): WorkflowStepRunRecord => ({
  id: 'sr-1',
  workflow_run_id: 'wr-1',
  step_id: 'step-1',
  agent_id: 'agent-1',
  partition_id: 0,
  status: 'completed',
  dependency_step_ids: [],
  input_step_ids: [],
  result_json: {
    reasoning: 'test reasoning',
    decision_summary: 'test decision',
    grounding_result: { type: 'exact', semantic_intent: 'test_intent' },
    inference_id: 'inf-1',
    action_intent_ids: ['ai-1']
  },
  error_json: null,
  action_intent_ids: [],
  attempt: 1,
  started_tick: 100n,
  completed_tick: 200n,
  lock_worker_id: null,
  lock_expires_at: null,
  idempotency_key: 'idem-1',
  ...overrides
});

describe('workflow_previous_output', () => {
  describe('buildPreviousAgentOutputScope', () => {
    it('builds scope from completed step runs', () => {
      const stepRuns = [
        makeStepRun({ step_id: 'step-a', agent_id: 'agent-1' }),
        makeStepRun({ step_id: 'step-b', agent_id: 'agent-2' })
      ];

      const result = buildPreviousAgentOutputScope({
        workflowRunId: 'wr-1',
        inputStepIds: ['step-a'],
        stepRuns
      });

      expect(Object.keys(result)).toEqual(['step-a']);
      expect(result['step-a'].source_type).toBe('previous_agent_output');
      expect(result['step-a'].workflow_run_id).toBe('wr-1');
      expect(result['step-a'].agent_id).toBe('agent-1');
      expect(result['step-a'].content.reasoning).toBe('test reasoning');
      expect(result['step-a'].content.decision_summary).toBe('test decision');
      expect(result['step-a'].content.grounding_result_type).toBe('exact');
      expect(result['step-a'].content.semantic_intent).toBe('test_intent');
    });

    it('skips non-completed step runs', () => {
      const stepRuns = [
        makeStepRun({ step_id: 'step-a', status: 'pending' })
      ];

      const result = buildPreviousAgentOutputScope({
        workflowRunId: 'wr-1',
        inputStepIds: ['step-a'],
        stepRuns
      });

      expect(Object.keys(result)).toHaveLength(0);
    });

    it('skips step runs without result_json', () => {
      const stepRuns = [
        makeStepRun({ step_id: 'step-a', result_json: null })
      ];

      const result = buildPreviousAgentOutputScope({
        workflowRunId: 'wr-1',
        inputStepIds: ['step-a'],
        stepRuns
      });

      expect(Object.keys(result)).toHaveLength(0);
    });

    it('skips missing step ids', () => {
      const stepRuns = [makeStepRun({ step_id: 'step-a' })];

      const result = buildPreviousAgentOutputScope({
        workflowRunId: 'wr-1',
        inputStepIds: ['nonexistent'],
        stepRuns
      });

      expect(Object.keys(result)).toHaveLength(0);
    });

    it('returns empty for empty input step ids', () => {
      const result = buildPreviousAgentOutputScope({
        workflowRunId: 'wr-1',
        inputStepIds: [],
        stepRuns: [makeStepRun({})]
      });

      expect(Object.keys(result)).toHaveLength(0);
    });

    it('includes multiple steps', () => {
      const stepRuns = [
        makeStepRun({ step_id: 'step-a', agent_id: 'agent-1' }),
        makeStepRun({ step_id: 'step-b', agent_id: 'agent-2' })
      ];

      const result = buildPreviousAgentOutputScope({
        workflowRunId: 'wr-1',
        inputStepIds: ['step-a', 'step-b'],
        stepRuns
      });

      expect(Object.keys(result)).toHaveLength(2);
      expect(result['step-a'].agent_id).toBe('agent-1');
      expect(result['step-b'].agent_id).toBe('agent-2');
    });
  });

  describe('buildPreviousAgentOutputTemplateScope', () => {
    it('converts scope to template-friendly format', () => {
      const scope = buildPreviousAgentOutputScope({
        workflowRunId: 'wr-1',
        inputStepIds: ['step-a'],
        stepRuns: [makeStepRun({ step_id: 'step-a', agent_id: 'agent-1' })]
      });

      const templateScope = buildPreviousAgentOutputTemplateScope(scope);

      expect(templateScope['step-a']).toBeDefined();
      const entry = templateScope['step-a'] as Record<string, unknown>;
      expect(entry.reasoning).toBe('test reasoning');
      expect(entry.decision_summary).toBe('test decision');
      expect(entry.grounding_result_type).toBe('exact');
      expect(entry.semantic_intent).toBe('test_intent');
      expect(entry.source_type).toBe('previous_agent_output');
      expect(entry.workflow_run_id).toBe('wr-1');
      expect(entry.agent_id).toBe('agent-1');
    });

    it('returns empty object for null input', () => {
      expect(buildPreviousAgentOutputTemplateScope(null)).toEqual({});
    });

    it('returns empty object for undefined input', () => {
      expect(buildPreviousAgentOutputTemplateScope(undefined)).toEqual({});
    });

    it('returns empty object for empty scope', () => {
      expect(buildPreviousAgentOutputTemplateScope({})).toEqual({});
    });
  });

  describe('hasAllRequiredPreviousAgentOutputs', () => {
    it('returns true when all input steps are completed', () => {
      const stepRuns = [
        makeStepRun({ step_id: 'step-a' }),
        makeStepRun({ step_id: 'step-b' })
      ];

      const result = hasAllRequiredPreviousAgentOutputs({
        inputStepIds: ['step-a', 'step-b'],
        stepRuns
      });

      expect(result).toBe(true);
    });

    it('returns false when some input steps are not completed', () => {
      const stepRuns = [
        makeStepRun({ step_id: 'step-a' }),
        makeStepRun({ step_id: 'step-b', status: 'pending' })
      ];

      const result = hasAllRequiredPreviousAgentOutputs({
        inputStepIds: ['step-a', 'step-b'],
        stepRuns
      });

      expect(result).toBe(false);
    });

    it('returns false when input step is missing', () => {
      const stepRuns = [makeStepRun({ step_id: 'step-a' })];

      const result = hasAllRequiredPreviousAgentOutputs({
        inputStepIds: ['step-a', 'step-missing'],
        stepRuns
      });

      expect(result).toBe(false);
    });

    it('returns true for empty input step ids', () => {
      const result = hasAllRequiredPreviousAgentOutputs({
        inputStepIds: [],
        stepRuns: [makeStepRun({})]
      });

      expect(result).toBe(true);
    });

    it('returns false when step has no result_json', () => {
      const stepRuns = [makeStepRun({ step_id: 'step-a', result_json: null })];

      const result = hasAllRequiredPreviousAgentOutputs({
        inputStepIds: ['step-a'],
        stepRuns
      });

      expect(result).toBe(false);
    });
  });
});
