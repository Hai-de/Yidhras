import type { MacroValue, ModifierSpec } from '../../core/types.js';
import type { PromptVariableContext } from './types.js';
import {
  lookupPromptVariable,
  previewPromptVariableValue
} from './variable_context.js';

export const parseLiteralValue = (input: string): unknown => {
  const trimmed = input.trim();

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (trimmed === 'null') {
    return null;
  }
  // eslint-disable-next-line security/detect-unsafe-regex -- simple number parsing, bounded input
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
};

export const applyDefaultModifier = (
  value: unknown,
  fallbackLiteral: MacroValue
): { value: unknown; fallbackApplied: boolean } => {
  const shouldApply = value === undefined || value === null || value === '';
  if (!shouldApply) {
    return { value, fallbackApplied: false };
  }
  if (typeof fallbackLiteral === 'string') {
    return { value: parseLiteralValue(fallbackLiteral), fallbackApplied: true };
  }
  return { value: fallbackLiteral, fallbackApplied: true };
};

export const createNarrativeVariableResolver = (
  variableContext: PromptVariableContext,
  localScope?: Record<string, unknown>
) => {
  return (path: string, pipeline: ModifierSpec[]) => {
// @ts-expect-error -- EOPT strict mode
    const lookup = lookupPromptVariable({
      expression: path,
      path,
      context: variableContext,
      localScope
    });

    let resolvedValue = lookup.value;
    let fallbackApplied = false;

    for (const modifier of pipeline) {
      if (modifier.name === 'default' && modifier.args.length > 0) {
        const result = applyDefaultModifier(resolvedValue, modifier.args[0]!);
        resolvedValue = result.value;
        fallbackApplied = result.fallbackApplied || fallbackApplied;
      }
    }

    const isMissing = resolvedValue === undefined;

    return {
      value: resolvedValue,
      missing: isMissing,
      restricted: lookup.trace.restricted,
      trace: {
        expression: path,
        resolved_path: path,
        resolved: !isMissing,
        missing: isMissing,
        restricted: lookup.trace.restricted,
        value_preview: !isMissing ? previewPromptVariableValue(resolvedValue) : undefined,
        fallback_applied: fallbackApplied,
        source: lookup.trace.resolved_layer,
        notes: fallbackApplied ? ['default_applied'] : undefined
      }
    };
  };
};
