import type { PreviousAgentOutputRecord } from '../../../inference/types.js';
import type { WorkflowStepRunRecord } from './workflow_types.js';

export type PreviousAgentOutputScope = Record<string, PreviousAgentOutputRecord>;

const COMPLETED_STATUS = 'completed';

export const buildPreviousAgentOutputScope = (input: {
  workflowRunId: string;
  inputStepIds: string[];
  stepRuns: WorkflowStepRunRecord[];
}): PreviousAgentOutputScope => {
  const stepRunByStepId = new Map(input.stepRuns.map(stepRun => [stepRun.step_id, stepRun]));
  const result: PreviousAgentOutputScope = {};

  for (const stepId of input.inputStepIds) {
    const sourceStep = stepRunByStepId.get(stepId);
    if (!sourceStep || sourceStep.status !== COMPLETED_STATUS || !sourceStep.result_json) {
      continue;
    }

    // eslint-disable-next-line security/detect-object-injection -- workflow step id comes from validated pack definition input_from.
    result[stepId] = {
      source_type: 'previous_agent_output',
      workflow_run_id: input.workflowRunId,
      step_id: sourceStep.step_id,
      agent_id: sourceStep.agent_id,
      content: {
        reasoning: sourceStep.result_json.reasoning,
        decision_summary: sourceStep.result_json.decision_summary,
        grounding_result_type: sourceStep.result_json.grounding_result.type,
        semantic_intent: sourceStep.result_json.grounding_result.semantic_intent
      }
    };
  }

  return result;
};

export const buildPreviousAgentOutputTemplateScope = (
  previousAgentOutput: PreviousAgentOutputScope | null | undefined
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const [stepId, output] of Object.entries(previousAgentOutput ?? {})) {
    // eslint-disable-next-line security/detect-object-injection -- keys are validated workflow step ids from previous_agent_output scope.
    result[stepId] = {
      reasoning: output.content.reasoning,
      decision_summary: output.content.decision_summary,
      grounding_result_type: output.content.grounding_result_type,
      semantic_intent: output.content.semantic_intent,
      source_type: output.source_type,
      workflow_run_id: output.workflow_run_id,
      step_id: output.step_id,
      agent_id: output.agent_id
    };
  }

  return result;
};

export const hasAllRequiredPreviousAgentOutputs = (input: {
  inputStepIds: string[];
  stepRuns: WorkflowStepRunRecord[];
}): boolean => {
  const stepRunByStepId = new Map(input.stepRuns.map(stepRun => [stepRun.step_id, stepRun]));
  return input.inputStepIds.every(stepId => {
    const sourceStep = stepRunByStepId.get(stepId);
    return Boolean(sourceStep && sourceStep.status === COMPLETED_STATUS && sourceStep.result_json);
  });
};
