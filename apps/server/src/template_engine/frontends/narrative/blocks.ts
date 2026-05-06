import type { AstNode, BlockHandlerFn, RenderScope } from '../../core/types.js';
import type { PromptVariableContext } from './types.js';
import { lookupPromptVariable } from './variable_context.js';

const isTruthyMacroValue = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    return value.length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
};

const parseEachSpec = (expression: string): { path: string; alias: string } | null => {
  const trimmed = expression.trim();
  const match = trimmed.match(/^([\w.]+)\s+as\s+([A-Za-z_][\w]*)$/);
  if (!match) {
    return null;
  }
  return {
    path: match[1],
    alias: match[2]
  };
};

interface NarrativeBlockScope extends RenderScope {
  variableContext?: PromptVariableContext;
}

const resolveNarrativeVar = (name: string, scope: NarrativeBlockScope): unknown => {
  const lookup = lookupPromptVariable({
    expression: name,
    path: name,
    context: scope.variableContext!,
    localScope: scope.variables
  });
  return lookup.value;
};

export const createNarrativeBlockHandlers = (): Record<string, BlockHandlerFn> => ({
  if: (condition: string, body: AstNode[], elseBody: AstNode[] | undefined, scope: RenderScope, renderFn) => {
    const condVar = resolveNarrativeVar(condition.trim(), scope);
    if (isTruthyMacroValue(condVar)) {
      return renderFn(body, scope);
    }
    if (elseBody && elseBody.length > 0) {
      return renderFn(elseBody, scope);
    }
    return '';
  },

  each: (condition: string, body: AstNode[], _elseBody: AstNode[] | undefined, scope: RenderScope, renderFn) => {
    const spec = parseEachSpec(condition);
    if (!spec) {
      return '';
    }

    const items = resolveNarrativeVar(spec.path, scope);
    if (!Array.isArray(items)) {
      return '';
    }

    const arr = items as unknown[];
    const parts: string[] = [];
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      const itemScope: RenderScope = {
        ...scope,
        variables: {
          ...scope.variables,
          [spec.alias]: item,
          index: i,
          first: i === 0,
          last: i === arr.length - 1
        }
      };
      parts.push(renderFn(body, itemScope));
    }
    return parts.join('');
  },

  with: (condition: string, body: AstNode[], _elseBody: AstNode[] | undefined, scope: RenderScope, renderFn) => {
    const ctx = resolveNarrativeVar(condition.trim(), scope);
    if (typeof ctx !== 'object' || ctx === null) {
      return '';
    }
    const withScope: RenderScope = {
      ...scope,
      variables: {
        ...scope.variables,
        ...ctx as Record<string, unknown>
      }
    };
    return renderFn(body, withScope);
  }
});
