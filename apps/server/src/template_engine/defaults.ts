import type { AstNode, BlockHandlerFn, ModifierFn , RenderScope,SyntaxConfig  } from './core/types.js';

export const DEFAULT_SYNTAX: SyntaxConfig = {
  delimiters: {
    variable: { open: '{', close: '}' },
    macro: { open: '{{', close: '}}' },
    blockOpen: { open: '{{#', close: '}}' },
    blockClose: { open: '{{/', close: '}}' },
    comment: { open: '{!--', close: '--}' },
    escape: '\\'
  },
  modifiers: {
    chainSeparator: '|',
    argOpen: '(',
    argClose: ')',
    namedArgSep: '='
  },
  blocks: {
    keywords: ['if', 'each', 'with'],
    elseKeyword: 'else',
    asKeyword: 'as'
  }
};

// === Built-in modifiers ===

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


export const BUILTIN_MODIFIERS: Record<string, ModifierFn> = {
  upper: (value: unknown) => toString(value).toUpperCase(),
  lower: (value: unknown) => toString(value).toLowerCase(),
  trim: (value: unknown) => toString(value).trim(),
  capitalize: (value: unknown) => {
    const str = toString(value);
    if (str.length === 0) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  },
  pad: (value: unknown, length: string) => {
    const str = toString(value);
    const n = parseInt(length, 10);
    if (isNaN(n) || n <= str.length) return str;
    return str.padEnd(n, ' ');
  },
  truncate: (value: unknown, length: string) => {
    const str = toString(value);
    const n = parseInt(length, 10);
    if (isNaN(n) || n >= str.length) return str;
    return str.slice(0, n);
  },
  default: (value: unknown, fallback: string) => {
    const str = toString(value);
    return str.length > 0 ? str : (fallback ?? '');
  }
};

// === Built-in block handlers ===


const isTruthy = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (value === false) return false;
  if (value === 0) return false;
  if (value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
};

const resolveVar = (name: string, scope: RenderScope): unknown => {
  return scope.variables[name];
};

export const BUILTIN_BLOCK_HANDLERS: Record<string, BlockHandlerFn> = {
  if: (condition: string, body: AstNode[], elseBody: AstNode[] | undefined, scope: RenderScope, renderFn) => {
    const condVar = resolveVar(condition.trim(), scope);
    if (isTruthy(condVar)) {
      return renderFn(body, scope);
    }
    if (elseBody && elseBody.length > 0) {
      return renderFn(elseBody, scope);
    }
    return '';
  },

  each: (condition: string, body: AstNode[], _elseBody: AstNode[] | undefined, scope: RenderScope, renderFn) => {
    const items = resolveVar(condition.trim(), scope);
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
          item,
          index: i,
          first: i === 0,
          last: i === items.length - 1
        }
      };
      parts.push(renderFn(body, itemScope));
    }
    return parts.join('');
  },

  with: (condition: string, body: AstNode[], _elseBody: AstNode[] | undefined, scope: RenderScope, renderFn) => {
    const ctx = resolveVar(condition.trim(), scope);
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
};
