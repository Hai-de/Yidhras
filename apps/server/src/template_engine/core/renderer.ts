import type { AstNode, RenderScope } from './types.js';

const DEFAULT_MAX_DEPTH = 32;

const toString = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

const resolveVariable = (name: string, scope: RenderScope): unknown => {
  const parts = name.split('.');
  let current: unknown = scope.variables;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  if (current === null || current === undefined) {
    return undefined;
  }

  if (typeof current === 'object' && !Array.isArray(current) && '_value' in current) {
    return (current as Record<string, unknown>)._value;
  }

  return current;
};

const applyModifiers = (value: unknown, node: { name: string; modifiers: { name: string; args: string[] }[] }, scope: RenderScope): string => {
  let current: unknown = value;

  for (const modifier of node.modifiers) {
    const fn = scope.modifiers[modifier.name];
    if (!fn) {
      continue;
    }
    try {
      current = fn(current, ...modifier.args);
    } catch {
      current = '';
    }
  }

  return toString(current);
};

const renderNodes = (nodes: AstNode[], scope: RenderScope): string => {
  if (scope.depth >= scope.maxDepth) {
    return '';
  }

  const parts: string[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        parts.push(node.content);
        break;
      }

      case 'variable': {
        const rawValue = resolveVariable(node.name, scope);
        const rendered = applyModifiers(rawValue, node, scope);
        parts.push(rendered);
        break;
      }

      case 'macro': {
        const handler = scope.macroHandlers?.[node.name];
        if (handler) {
          parts.push(handler(node.name, node.args, scope));
        } else {
          parts.push('');
        }
        break;
      }

      case 'block': {
        const handler = scope.blockHandlers[node.keyword];
        if (handler) {
          const innerScope: RenderScope = {
            ...scope,
            depth: scope.depth + 1
          };
          const result = handler(
            node.condition,
            node.body,
            node.elseBody,
            innerScope,
            (childNodes, childScope) => renderNodes(childNodes, childScope)
          );
          parts.push(result);
        }
        break;
      }
    }
  }

  return parts.join('');
};

export const renderAst = (nodes: AstNode[], scope: RenderScope): string => {
  const effectiveScope: RenderScope = {
    ...scope,
    depth: scope.depth ?? 0,
    maxDepth: scope.maxDepth ?? DEFAULT_MAX_DEPTH
  };
  return renderNodes(nodes, effectiveScope);
};
