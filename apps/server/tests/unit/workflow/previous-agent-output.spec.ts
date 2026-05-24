import { describe, expect, it } from 'vitest';

import {
  buildPreviousAgentOutputScope,
  buildPreviousAgentOutputTemplateScope,
  hasAllRequiredPreviousAgentOutputs
} from '../../../src/app/services/workflow/workflow_previous_output.js';
import type { WorkflowStepRunRecord } from '../../../src/app/services/workflow/workflow_types.js';
import { renderNarrativeTemplate } from '../../../src/template_engine/frontends/narrative/resolver.js';
import type { PromptVariableValue } from '../../../src/template_engine/frontends/narrative/types.js';
import { createPromptVariableContext, createPromptVariableLayer, normalizePromptVariableRecord } from '../../../src/template_engine/frontends/narrative/variable_context.js';

const createStepRun = ({ step_id, status, ...overrides }: Partial<WorkflowStepRunRecord> & Pick<WorkflowStepRunRecord, 'step_id' | 'status'>): WorkflowStepRunRecord => ({
  id: `step-run-${step_id}`,
  workflow_run_id: 'workflow-run-1',
  step_id,
  agent_id: `agent-${step_id}`,
  partition_id: 0,
  status,
  dependency_step_ids: [],
  input_step_ids: [],
  result_json: overrides.result_json ?? null,
  error_json: null,
  action_intent_ids: [],
  attempt: 1,
  started_tick: null,
  completed_tick: status === 'completed' ? 100n : null,
  lock_worker_id: null,
  lock_expires_at: null,
  idempotency_key: `step-key-${step_id}`,
  ...overrides
});

const completedDraftStep = createStepRun({
  step_id: 'draft',
  status: 'completed',
  result_json: {
    reasoning: 'draft reasoning',
    decision_summary: 'drafted',
    grounding_result: {
      type: 'exact',
      semantic_intent: 'draft_proposal'
    },
    inference_id: 'inf-draft',
    action_intent_ids: ['intent-draft']
  }
});

const pendingReviewStep = createStepRun({
  step_id: 'review',
  status: 'pending'
});

describe('workflow previous_agent_output', () => {
  it('builds previous_agent_output scope only from completed input steps', () => {
    const scope = buildPreviousAgentOutputScope({
      workflowRunId: 'workflow-run-1',
      inputStepIds: ['draft', 'missing'],
      stepRuns: [completedDraftStep, pendingReviewStep]
    });

    expect(scope).toEqual({
      draft: {
        source_type: 'previous_agent_output',
        workflow_run_id: 'workflow-run-1',
        step_id: 'draft',
        agent_id: 'agent-draft',
        content: {
          reasoning: 'draft reasoning',
          decision_summary: 'drafted',
          grounding_result_type: 'exact',
          semantic_intent: 'draft_proposal'
        }
      }
    });
  });

  it('requires all input_from sources to be completed before a step is ready', () => {
    expect(hasAllRequiredPreviousAgentOutputs({
      inputStepIds: ['draft'],
      stepRuns: [completedDraftStep]
    })).toBe(true);

    expect(hasAllRequiredPreviousAgentOutputs({
      inputStepIds: ['draft', 'review'],
      stepRuns: [completedDraftStep, pendingReviewStep]
    })).toBe(false);
  });

  it('exposes previous_agent_output to narrative templates by step id', () => {
    const scope = buildPreviousAgentOutputScope({
      workflowRunId: 'workflow-run-1',
      inputStepIds: ['draft'],
      stepRuns: [completedDraftStep]
    });
    const templateScope = buildPreviousAgentOutputTemplateScope(scope);
    const promptScope = normalizePromptVariableRecord(templateScope);
    const variableContext = createPromptVariableContext({
      layers: [
        createPromptVariableLayer({
          namespace: 'previous_agent_output',
          values: promptScope,
          alias_values: {
            previous_agent_output: promptScope as PromptVariableValue
          }
        })
      ]
    });

    const rendered = renderNarrativeTemplate({
      template: '{{previous_agent_output.draft.reasoning}} / {{previous_agent_output.draft.semantic_intent}}',
      variableContext
    });

    expect(rendered.text).toBe('draft reasoning / draft_proposal');
    expect(rendered.diagnostics.missing_paths).toEqual([]);
  });
});
