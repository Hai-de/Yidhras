import type { WorkflowConditionEvaluationInput, WorkflowConditionEvaluationResult, WorkflowStepResultJson } from './workflow_types.js';

type JsonScalar = string | number | boolean | null;

type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const isJsonScalar = (value: unknown): value is JsonScalar => {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
};

const toConditionReadableResult = (result: WorkflowStepResultJson): JsonObject => ({
  reasoning: result.reasoning,
  decision_summary: result.decision_summary,
  grounding_result: result.grounding_result,
  inference_id: result.inference_id,
  action_intent_ids: result.action_intent_ids
});

const readPath = (root: JsonObject, path: string[]): { ok: true; value: JsonScalar } | { ok: false; code: string; message: string } => {
  let current: unknown = root;

  for (const segment of path) {
    if (!isJsonObject(current)) {
      return {
        ok: false,
        code: 'WORKFLOW_CONDITION_NON_OBJECT_PATH',
        message: `condition path segment "${segment}" cannot be read from a non-object value`
      };
    }
    if (!(segment in current)) {
      return {
        ok: false,
        code: 'WORKFLOW_CONDITION_FIELD_MISSING',
        message: `condition field path is missing segment "${segment}"`
      };
    }
    current = current[segment];
  }

  if (!isJsonScalar(current)) {
    return {
      ok: false,
      code: 'WORKFLOW_CONDITION_NON_SCALAR_VALUE',
      message: 'condition field value must be a JSON scalar'
    };
  }

  return { ok: true, value: current };
};

export const evaluateWorkflowCondition = ({
  condition,
  completedStepResults
}: WorkflowConditionEvaluationInput): WorkflowConditionEvaluationResult => {
  const [stepId, ...fieldPath] = condition.field.split('.').filter(segment => segment.length > 0);
  if (!stepId || fieldPath.length === 0) {
    return {
      outcome: 'condition_error',
      code: 'WORKFLOW_CONDITION_INVALID_FIELD',
      message: 'condition field must use <step_id>.<path...> format'
    };
  }

  const stepResult = completedStepResults.get(stepId);
  if (!stepResult) {
    return {
      outcome: 'condition_error',
      code: 'WORKFLOW_CONDITION_STEP_RESULT_MISSING',
      message: `condition references step "${stepId}" without a completed result`
    };
  }

  const readResult = readPath(toConditionReadableResult(stepResult), fieldPath);
  if (!readResult.ok) {
    return {
      outcome: 'condition_error',
      code: readResult.code,
      message: readResult.message
    };
  }

  const isEqual = Object.is(readResult.value, condition.value);
  if (condition.op === 'eq') {
    return { outcome: isEqual ? 'true' : 'false' };
  }

  return { outcome: isEqual ? 'false' : 'true' };
};
