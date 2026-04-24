import type { PromptVariableRecord, PromptVariableValue } from '../narrative/types.js';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const getValueAtPath = (path: string, root: Record<string, unknown>): unknown => {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (isRecord(current) && segment in current) {
      return current[segment];
    }
    return undefined;
  }, root);
};

const parseTemplateExpression = (expression: string): { path: string; fallback?: string } => {
  const trimmed = expression.trim();
  const fallbackIndex = trimmed.indexOf('??');
  if (fallbackIndex >= 0) {
    return {
      path: trimmed.slice(0, fallbackIndex).trim(),
      fallback: trimmed.slice(fallbackIndex + 2).trim()
    };
  }
  return { path: trimmed };
};

const isTemplateString = (value: unknown): value is string => {
  return typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}');
};

const resolveTemplateValue = (
  template: string,
  runtimeObjects: Record<string, unknown>
): PromptVariableValue => {
  const inner = template.slice(2, -2).trim();
  const { path, fallback } = parseTemplateExpression(inner);
  const resolved = getValueAtPath(path, runtimeObjects);
  if (resolved !== undefined) {
    return resolved as PromptVariableValue;
  }
  if (fallback !== undefined) {
    const fallbackResolved = getValueAtPath(fallback, runtimeObjects);
    if (fallbackResolved !== undefined) {
      return fallbackResolved as PromptVariableValue;
    }
    return fallback as PromptVariableValue;
  }
  return null;
};

const resolveValue = (
  value: unknown,
  runtimeObjects: Record<string, unknown>
): PromptVariableValue => {
  if (isTemplateString(value)) {
    return resolveTemplateValue(value, runtimeObjects);
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveValue(entry, runtimeObjects));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveValue(entry, runtimeObjects)])
    );
  }
  return String(value);
};

export const resolveConfigValues = (
  configValues: Record<string, unknown> | undefined,
  runtimeObjects: Record<string, unknown>
): PromptVariableRecord => {
  if (!configValues) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(configValues).map(([key, value]) => [key, resolveValue(value, runtimeObjects)])
  );
};
