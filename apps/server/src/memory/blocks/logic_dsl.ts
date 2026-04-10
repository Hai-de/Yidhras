import type { MemoryLogicExpr } from './types.js';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const getPathValues = (root: unknown, path: string): unknown[] => {
  if (!path || typeof path !== 'string') {
    return [];
  }

  const segments = path
    .split('.')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0);

  if (segments.length === 0) {
    return [];
  }

  let current: unknown[] = [root];
  for (const segment of segments) {
    const next: unknown[] = [];

    for (const value of current) {
      if (segment === '*') {
        if (Array.isArray(value)) {
          next.push(...value);
        } else if (isRecord(value)) {
          next.push(...Object.values(value));
        }
        continue;
      }

      if (Array.isArray(value)) {
        if (/^\d+$/.test(segment)) {
          const index = Number.parseInt(segment, 10);
          if (index >= 0 && index < value.length) {
            next.push(value[index]);
          }
        } else {
          for (const item of value) {
            if (isRecord(item) && segment in item) {
              next.push(item[segment]);
            }
          }
        }
        continue;
      }

      if (isRecord(value) && segment in value) {
        next.push(value[segment]);
      }
    }

    current = next;
    if (current.length === 0) {
      return [];
    }
  }

  return current;
};

const toComparableString = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  return JSON.stringify(value);
};

const matchesEq = (actual: unknown, expected: unknown): boolean => {
  return toComparableString(actual) === toComparableString(expected);
};

const matchesIn = (actual: unknown, values: unknown[]): boolean => {
  return values.some(candidate => matchesEq(actual, candidate));
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'bigint') {
    const casted = Number(value);
    return Number.isFinite(casted) ? casted : null;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const evaluateLeaf = (expr: Exclude<MemoryLogicExpr, { op: 'and'; items: MemoryLogicExpr[] } | { op: 'or'; items: MemoryLogicExpr[] } | { op: 'not'; item: MemoryLogicExpr }>, root: unknown): boolean => {
  const values = getPathValues(root, expr.path);

  switch (expr.op) {
    case 'eq':
      return values.some(value => matchesEq(value, expr.value));
    case 'in':
      return values.some(value => matchesIn(value, expr.values));
    case 'gt':
      return values.some(value => {
        const actual = toNumber(value);
        return actual !== null && actual > expr.value;
      });
    case 'lt':
      return values.some(value => {
        const actual = toNumber(value);
        return actual !== null && actual < expr.value;
      });
    case 'contains':
      return values.some(value => {
        if (typeof value === 'string') {
          return value.includes(expr.value);
        }

        if (Array.isArray(value)) {
          return value.some(item => toComparableString(item).includes(expr.value));
        }

        return false;
      });
    case 'exists':
      return values.length > 0;
    default:
      return false;
  }
};

export const evaluateMemoryLogicExpr = (expr: MemoryLogicExpr, root: unknown): boolean => {
  switch (expr.op) {
    case 'and':
      return expr.items.every(item => evaluateMemoryLogicExpr(item, root));
    case 'or':
      return expr.items.some(item => evaluateMemoryLogicExpr(item, root));
    case 'not':
      return !evaluateMemoryLogicExpr(expr.item, root);
    default:
      return evaluateLeaf(expr, root);
  }
};

export const debugResolveMemoryLogicPath = (root: unknown, path: string): unknown[] => {
  return getPathValues(root, path);
};
