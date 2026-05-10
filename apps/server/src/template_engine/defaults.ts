import type { AstNode, BlockHandlerFn, MacroHandlerFn, MacroValue, ModifierFn, RenderScope, SyntaxConfig } from './core/types.js';

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

const toNumber = (value: MacroValue, fallback: number): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    return isNaN(n) ? fallback : n;
  }
  return fallback;
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
  pad: (value: unknown, length: MacroValue) => {
    const str = toString(value);
    const n = toNumber(length, 0);
    if (n <= str.length) return str;
    return str.padEnd(n, ' ');
  },
  truncate: (value: unknown, length: MacroValue) => {
    const str = toString(value);
    const n = toNumber(length, 0);
    if (n >= str.length) return str;
    return str.slice(0, n);
  },
  default: (value: unknown, fallback: MacroValue) => {
    const str = toString(value);
    return str.length > 0 ? str : toString(fallback);
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

// === Built-in macro handlers ===

const resolveRng = (scope: RenderScope): (() => number) => {
  if (scope.prng) {
    return () => scope.prng!.next();
  }
  return Math.random;
};

const fisherYatesShuffle = <T>(arr: T[], rng: () => number): T[] => {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

export const BUILTIN_MACRO_HANDLERS: Record<string, MacroHandlerFn> = {
  roll: (_name: string, args: Record<string, MacroValue>, scope: RenderScope): MacroValue => {
    const rng = resolveRng(scope);
    const count = Math.max(1, toNumber(args.count ?? 1, 1));
    const sides = Math.max(1, toNumber(args.sides ?? 6, 6));
    let total = 0;
    for (let i = 0; i < count; i++) {
      total += Math.floor(rng() * sides) + 1;
    }
    return total;
  },

  pick: (_name: string, args: Record<string, MacroValue>, scope: RenderScope): MacroValue => {
    const rng = resolveRng(scope);
    const fromRaw = args.from;

    let from: string[];
    if (Array.isArray(fromRaw)) {
      from = fromRaw.map((v) => toString(v)).filter(Boolean);
    } else if (typeof fromRaw === 'string') {
      from = fromRaw.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      return '';
    }

    if (from.length === 0) {
      return '';
    }
    const count = Math.max(1, toNumber(args.count ?? 1, 1));
    if (count >= from.length) {
      const shuffled = fisherYatesShuffle(from, rng);
      return shuffled.length === 1 ? shuffled[0] : shuffled;
    }
    const shuffled = fisherYatesShuffle(from, rng);
    const picked = shuffled.slice(0, count);
    return picked.length === 1 ? picked[0] : picked;
  },

  int: (_name: string, args: Record<string, MacroValue>, scope: RenderScope): MacroValue => {
    const rng = resolveRng(scope);
    const min = toNumber(args.min ?? 0, 0);
    const max = toNumber(args.max ?? 100, 100);
    const result = Math.floor(rng() * (max - min + 1)) + min;
    return result;
  },

  float: (_name: string, args: Record<string, MacroValue>, scope: RenderScope): MacroValue => {
    const rng = resolveRng(scope);
    const min = typeof args.min === 'number' ? args.min : parseFloat(String(args.min ?? '0')) || 0;
    const max = typeof args.max === 'number' ? args.max : parseFloat(String(args.max ?? '1')) || 1;
    const result = rng() * (max - min) + min;
    return result;
  },

  seed: (_name: string, _args: Record<string, MacroValue>, scope: RenderScope): MacroValue => {
    return scope.prng?.getSeed() ?? '';
  }
};

// === Built-in block handlers ===

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
