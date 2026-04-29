import { ApiError } from '../utils/api_error.js';
import type { AiResolvedTaskConfig, ModelGatewayResponse } from './types.js';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const resolvePath = (value: unknown, path: string | undefined): unknown => {
  if (!path || path.trim().length === 0) {
    return value;
  }

  return path
    .split('.')
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .reduce<unknown>((current, part) => {
      if (!isRecord(current)) {
        return undefined;
      }
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
      return current[part];
    }, value);
};

const applyFieldAliases = (value: Record<string, unknown>, aliasMap?: Record<string, string>): Record<string, unknown> => {
  if (!aliasMap) {
    return { ...value };
  }

  const next = { ...value };
  for (const [sourceKey, targetKey] of Object.entries(aliasMap)) {
    if (sourceKey in next && !(targetKey in next)) {
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
      next[targetKey] = next[sourceKey];
    }
  }

  return next;
};

const applyDefaults = (value: Record<string, unknown>, defaults?: Record<string, unknown>): Record<string, unknown> => {
  if (!defaults) {
    return { ...value };
  }

  return {
    ...defaults,
    ...value
  };
};

const validateType = (value: unknown, expectedType: string): boolean => {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
};

const validateSchemaNode = (value: unknown, schema: Record<string, unknown>, path = '$'): string[] => {
  if (Array.isArray(schema.anyOf)) {
    const valid = schema.anyOf.some(option => isRecord(option) && validateSchemaNode(value, option, path).length === 0);
    return valid ? [] : [`${path} does not satisfy anyOf schema`];
  }

  const issues: string[] = [];
  if (typeof schema.type === 'string' && !validateType(value, schema.type)) {
    issues.push(`${path} must be ${schema.type}`);
    return issues;
  }

  if (schema.type === 'object' && isRecord(value)) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : [];
    for (const field of required) {
      if (!(field in value)) {
        issues.push(`${path}.${field} is required`);
      }
    }

    if (isRecord(schema.properties)) {
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        if (!(key in value) || !isRecord(propertySchema)) {
          continue;
        }
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
        issues.push(...validateSchemaNode(value[key], propertySchema, `${path}.${key}`));
      }
    }
  }

  if (schema.type === 'array' && Array.isArray(value) && isRecord(schema.items)) {
    value.forEach((item, index) => {
      issues.push(...validateSchemaNode(item, schema.items as Record<string, unknown>, `${path}[${String(index)}]`));
    });
  }

  return issues;
};

const extractJsonCandidate = (response: ModelGatewayResponse): Record<string, unknown> => {
  if (isRecord(response.output.json)) {
    return response.output.json;
  }

  if (typeof response.output.text === 'string' && response.output.text.trim().length > 0) {
    try {
      const parsed = JSON.parse(response.output.text) as unknown;
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      // ignore parse failure and fall through
    }
  }

  throw new ApiError(500, 'AI_TASK_OUTPUT_INVALID', 'Expected a structured JSON object response', {
    task_type: response.task_type,
    response_mode: response.output.mode,
    finish_reason: response.finish_reason
  });
};

const normalizeStructuredObject = (
  response: ModelGatewayResponse,
  taskConfig: AiResolvedTaskConfig
): Record<string, unknown> => {
  const extracted = extractJsonCandidate(response);
  const unwrapped = resolvePath(extracted, taskConfig.parse.unwrap);

  if (!isRecord(unwrapped)) {
    throw new ApiError(500, 'AI_TASK_OUTPUT_INVALID', 'Decoded structured output is not an object after unwrap', {
      task_type: response.task_type,
      unwrap: taskConfig.parse.unwrap ?? null
    });
  }

  const withAliases = applyFieldAliases(unwrapped, taskConfig.parse.field_alias);
  const withDefaults = applyDefaults(withAliases, taskConfig.parse.defaults);
  const requiredFields = new Set<string>(taskConfig.parse.required_fields ?? []);

  const schemaRequired = Array.isArray(taskConfig.output.schema?.required)
    ? taskConfig.output.schema.required.filter((item): item is string => typeof item === 'string')
    : [];
  schemaRequired.forEach(field => requiredFields.add(field));

  const missing = Array.from(requiredFields).filter(field => !(field in withDefaults));
  if (missing.length > 0) {
    throw new ApiError(500, 'AI_TASK_OUTPUT_INVALID', 'Structured output is missing required fields', {
      task_type: response.task_type,
      missing_fields: missing
    });
  }

  if (taskConfig.output.schema && taskConfig.output.strict) {
    const issues = validateSchemaNode(withDefaults, taskConfig.output.schema, '$');
    if (issues.length > 0) {
      throw new ApiError(500, 'AI_TASK_OUTPUT_INVALID', 'Structured output failed schema validation', {
        task_type: response.task_type,
        issues
      });
    }
  }

  return withDefaults;
};

export const decodeAiTaskOutput = <TOutput = unknown>(
  response: ModelGatewayResponse,
  taskConfig: AiResolvedTaskConfig
): TOutput => {
  switch (taskConfig.output.mode) {
    case 'embedding': {
      if (!Array.isArray(response.output.embedding)) {
        throw new ApiError(500, 'AI_TASK_OUTPUT_INVALID', 'Expected embedding output', {
          task_type: response.task_type
        });
      }
      return response.output.embedding as TOutput;
    }
    case 'free_text': {
      if (typeof response.output.text !== 'string') {
        throw new ApiError(500, 'AI_TASK_OUTPUT_INVALID', 'Expected text output', {
          task_type: response.task_type
        });
      }
      return response.output.text as TOutput;
    }
    case 'tool_call': {
      if (!Array.isArray(response.output.tool_calls)) {
        throw new ApiError(500, 'AI_TASK_OUTPUT_INVALID', 'Expected tool call output', {
          task_type: response.task_type
        });
      }
      return response.output.tool_calls as TOutput;
    }
    case 'json_object':
    case 'json_schema':
    default:
      return normalizeStructuredObject(response, taskConfig) as TOutput;
  }
};
