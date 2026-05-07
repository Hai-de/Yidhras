import { afterEach, describe, expect, it } from 'vitest';

import type { SlotConditionInput, SlotConditionContext } from '../../src/inference/slot_condition_evaluators.js';
import {
  evaluateBuiltinCondition,
  evaluateCustomCondition,
  evaluateSlotLogicExpr,
  resolveDotPath,
  resolveWildcardPaths
} from '../../src/inference/slot_condition_evaluators.js';
import type { SlotLogicExpr } from '../../src/inference/slot_behavior.js';
import { slotConditionRegistry } from '../../src/plugins/extensions/slot_condition_registry.js';

const baseCtx = (overrides: Partial<SlotConditionContext> = {}): SlotConditionContext => ({
  slot_id: 'test_slot',
  variables: {},
  conversation_meta: { turn_count: 0 },
  token_budget: { total: 8192, used: 1000, remaining: 7192 },
  current_tick: 1,
  last_user_message: '',
  ...overrides
});

// ── resolveDotPath ──

describe('resolveDotPath', () => {
  it('resolves simple dot-path', () => {
    const obj = { a: { b: 42 } };
    expect(resolveDotPath(obj, 'a.b')).toBe(42);
  });

  it('resolves single-level path', () => {
    const obj = { x: 'hello' };
    expect(resolveDotPath(obj, 'x')).toBe('hello');
  });

  it('resolves array index', () => {
    const obj = { items: [{ name: 'a' }, { name: 'b' }] };
    expect(resolveDotPath(obj, 'items[0].name')).toBe('a');
    expect(resolveDotPath(obj, 'items[1].name')).toBe('b');
  });

  it('resolves negative array index', () => {
    const obj = { items: [{ name: 'a' }, { name: 'b' }] };
    expect(resolveDotPath(obj, 'items[-1].name')).toBe('b');
  });

  it('returns undefined for missing path', () => {
    const obj = { a: {} };
    expect(resolveDotPath(obj, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined for null intermediate', () => {
    const obj = { a: null };
    expect(resolveDotPath(obj as unknown as Record<string, unknown>, 'a.b')).toBeUndefined();
  });

  it('blocks __proto__ access', () => {
    const obj = { a: 1 };
    expect(resolveDotPath(obj, '__proto__.x')).toBeUndefined();
  });

  it('blocks constructor access', () => {
    const obj = { a: 1 };
    expect(resolveDotPath(obj, 'constructor.name')).toBeUndefined();
  });

  it('blocks prototype access', () => {
    const obj = { a: 1 };
    expect(resolveDotPath(obj, 'a.prototype.x')).toBeUndefined();
  });

  it('returns undefined for non-array index access', () => {
    const obj = { a: { b: 1 } };
    expect(resolveDotPath(obj, 'a[0]')).toBeUndefined();
  });
});

// ── resolveWildcardPaths ──

describe('resolveWildcardPaths', () => {
  it('expands single wildcard at top level', () => {
    const obj = { a: 1, b: 2, c: 3 };
    const results = resolveWildcardPaths(obj, '*');
    expect(results.sort()).toEqual([1, 2, 3]);
  });

  it('expands wildcard at middle segment', () => {
    const obj = {
      items: {
        x: { name: 'x-name' },
        y: { name: 'y-name' }
      }
    };
    const results = resolveWildcardPaths(obj, 'items.*.name');
    expect(results.sort()).toEqual(['x-name', 'y-name']);
  });

  it('returns empty array for wildcard on non-object', () => {
    const obj = { a: 42 };
    const results = resolveWildcardPaths(obj, 'a.*');
    expect(results).toEqual([]);
  });

  it('skips forbidden segments', () => {
    const obj = { __proto__: { x: 'bad' }, ok: { x: 'good' } };
    const results = resolveWildcardPaths(obj, '*.x');
    expect(results).toEqual(['good']);
  });

  it('returns empty for non-existent path', () => {
    const obj = { a: { b: 1 } };
    expect(resolveWildcardPaths(obj, 'x.*')).toEqual([]);
  });

  it('returns empty for wildcard on array', () => {
    const obj = { arr: [1, 2, 3] };
    expect(resolveWildcardPaths(obj, 'arr.*')).toEqual([]);
  });

  it('works with array index in wildcard path', () => {
    const obj = {
      groups: {
        a: { members: ['x', 'y'] },
        b: { members: ['z'] }
      }
    };
    const results = resolveWildcardPaths(obj, 'groups.*.members[0]');
    expect(results.sort()).toEqual(['x', 'z']);
  });

  it('no wildcard returns single-value array', () => {
    const obj = { a: { b: 42 } };
    expect(resolveWildcardPaths(obj, 'a.b')).toEqual([42]);
  });

  it('deeply nested wildcards', () => {
    const obj = {
      a: { inner: { val: 1 } },
      b: { inner: { val: 2 } }
    };
    expect(resolveWildcardPaths(obj, '*.inner.val').sort()).toEqual([1, 2]);
  });
});

// ── evaluateSlotLogicExpr (wildcards) ──

describe('evaluateSlotLogicExpr — wildcard paths', () => {
  const vars = {
    entities: {
      e1: { hp: 100 },
      e2: { hp: 50 },
      e3: { hp: 0 }
    },
    tags: {
      t1: { label: 'urgent' },
      t2: { label: 'normal' }
    }
  };

  it('eq with wildcard: activates when any path matches', () => {
    const expr: SlotLogicExpr = { eq: { path: 'entities.*.hp', value: 100 } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('eq with wildcard: returns false when none match', () => {
    const expr: SlotLogicExpr = { eq: { path: 'entities.*.hp', value: 999 } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(false);
  });

  it('gt with wildcard: activates when any value exceeds threshold', () => {
    const expr: SlotLogicExpr = { gt: { path: 'entities.*.hp', value: 75 } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('lt with wildcard: all values below threshold', () => {
    const expr: SlotLogicExpr = { lt: { path: 'entities.*.hp', value: 200 } };
    // ANY: 100 < 200 → true (at least one matches)
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('neq with wildcard: all must differ from value', () => {
    const expr: SlotLogicExpr = { neq: { path: 'entities.*.hp', value: 999 } };
    // ALL must be ≠ 999: 100≠999, 50≠999, 0≠999 → true
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('neq with wildcard: fails when any equals value', () => {
    const expr: SlotLogicExpr = { neq: { path: 'entities.*.hp', value: 50 } };
    // e2.hp=50 matches → not all are ≠ 50 → false
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(false);
  });

  it('contains with wildcard: finds matching string', () => {
    const expr: SlotLogicExpr = { contains: { path: 'tags.*.label', value: 'urg' } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('contains with wildcard: returns false when none match', () => {
    const expr: SlotLogicExpr = { contains: { path: 'tags.*.label', value: 'xyz' } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(false);
  });

  it('exists with wildcard: true when path resolves', () => {
    const expr: SlotLogicExpr = { exists: { path: 'entities.*.hp' } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('exists with wildcard: false when path does not resolve', () => {
    const expr: SlotLogicExpr = { exists: { path: 'nonexistent.*.x' } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(false);
  });

  it('wildcard in nested and', () => {
    const expr: SlotLogicExpr = {
      and: [
        { exists: { path: 'entities.*.hp' } },
        { gt: { path: 'entities.*.hp', value: 0 } }
      ]
    };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });
});

// ── evaluateSlotLogicExpr ──

describe('evaluateSlotLogicExpr', () => {
  const vars = {
    x: 10,
    y: 5,
    name: 'test',
    active: true,
    nested: { value: 42, text: 'hello world' },
    list: ['a', 'b', 'c']
  };

  it('eq: matches equal values', () => {
    const expr: SlotLogicExpr = { eq: { path: 'x', value: 10 } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('eq: returns false for different values', () => {
    const expr: SlotLogicExpr = { eq: { path: 'x', value: 99 } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(false);
  });

  it('neq: returns true for different values', () => {
    const expr: SlotLogicExpr = { neq: { path: 'x', value: 99 } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('gt: numeric greater-than', () => {
    const expr: SlotLogicExpr = { gt: { path: 'x', value: 5 } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('gt: returns false when not greater', () => {
    const expr: SlotLogicExpr = { gt: { path: 'x', value: 100 } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(false);
  });

  it('lt: numeric less-than', () => {
    const expr: SlotLogicExpr = { lt: { path: 'y', value: 10 } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('gte: greater-than-or-equal', () => {
    const expr: SlotLogicExpr = { gte: { path: 'x', value: 10 } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('lte: less-than-or-equal', () => {
    const expr: SlotLogicExpr = { lte: { path: 'x', value: 10 } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('contains: string substring match', () => {
    const expr: SlotLogicExpr = { contains: { path: 'nested.text', value: 'hello' } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('contains: returns false for non-string value', () => {
    const expr: SlotLogicExpr = { contains: { path: 'x', value: 'anything' } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(false);
  });

  it('contains: returns false for non-match', () => {
    const expr: SlotLogicExpr = { contains: { path: 'nested.text', value: 'xyz' } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(false);
  });

  it('exists: true when path has non-null value', () => {
    const expr: SlotLogicExpr = { exists: { path: 'nested.value' } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('exists: false when path is undefined', () => {
    const expr: SlotLogicExpr = { exists: { path: 'nope.nope' } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(false);
  });

  it('and: all sub-expressions must be true', () => {
    const expr: SlotLogicExpr = { and: [{ eq: { path: 'x', value: 10 } }, { gt: { path: 'x', value: 5 } }] };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('and: returns false if any sub-expression is false', () => {
    const expr: SlotLogicExpr = { and: [{ eq: { path: 'x', value: 10 } }, { eq: { path: 'x', value: 99 } }] };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(false);
  });

  it('or: returns true if any sub-expression is true', () => {
    const expr: SlotLogicExpr = { or: [{ eq: { path: 'x', value: 10 } }, { eq: { path: 'x', value: 99 } }] };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('or: returns false if all are false', () => {
    const expr: SlotLogicExpr = { or: [{ eq: { path: 'x', value: 99 } }, { eq: { path: 'y', value: 99 } }] };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(false);
  });

  it('not: inverts result', () => {
    const expr: SlotLogicExpr = { not: { eq: { path: 'x', value: 99 } } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('deeply nested expression', () => {
    const expr: SlotLogicExpr = {
      and: [
        { gt: { path: 'x', value: 0 } },
        { not: { or: [{ eq: { path: 'y', value: 99 } }, { eq: { path: 'name', value: '' } }] } }
      ]
    };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });

  it('returns false on aborted signal', () => {
    const controller = new AbortController();
    controller.abort();
    const expr: SlotLogicExpr = { eq: { path: 'x', value: 10 } };
    expect(evaluateSlotLogicExpr(expr, vars, controller.signal)).toBe(false);
  });

  it('eq with null value', () => {
    const expr: SlotLogicExpr = { eq: { path: 'nope', value: null } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(false);
  });

  it('eq with boolean value', () => {
    const expr: SlotLogicExpr = { eq: { path: 'active', value: true } };
    expect(evaluateSlotLogicExpr(expr, vars)).toBe(true);
  });
});

// ── evaluateKeywordMatch ──

describe('evaluateKeywordMatch', () => {
  const condition: SlotConditionInput = {
    type: 'keyword_match',
    keywords: ['hello', 'world']
  };

  it('activates when any keyword matches (any mode)', () => {
    const ctx = baseCtx({ last_user_message: 'hello there' });
    const result = evaluateBuiltinCondition({ ...condition, match_mode: 'any' }, ctx);
    expect(result.active).toBe(true);
  });

  it('does not activate when no keyword matches (any mode)', () => {
    const ctx = baseCtx({ last_user_message: 'goodbye' });
    const result = evaluateBuiltinCondition({ ...condition, match_mode: 'any' }, ctx);
    expect(result.active).toBe(false);
  });

  it('activates when all keywords match (all mode)', () => {
    const ctx = baseCtx({ last_user_message: 'hello world' });
    const result = evaluateBuiltinCondition({ ...condition, match_mode: 'all' }, ctx);
    expect(result.active).toBe(true);
  });

  it('does not activate when not all keywords match (all mode)', () => {
    const ctx = baseCtx({ last_user_message: 'hello there' });
    const result = evaluateBuiltinCondition({ ...condition, match_mode: 'all' }, ctx);
    expect(result.active).toBe(false);
  });

  it('defaults to any mode', () => {
    const ctx = baseCtx({ last_user_message: 'hello' });
    const result = evaluateBuiltinCondition({ type: 'keyword_match', keywords: ['hello'] }, ctx);
    expect(result.active).toBe(true);
  });

  it('returns false when last_user_message is empty', () => {
    const ctx = baseCtx({ last_user_message: '' });
    const result = evaluateBuiltinCondition(condition, ctx);
    expect(result.active).toBe(false);
    expect(result.reason).toBe('last_user_message is empty');
  });
});

// ── evaluateContextLength ──

describe('evaluateContextLength', () => {
  it('activates when remaining is above threshold', () => {
    const ctx = baseCtx({ token_budget: { total: 8192, used: 1000, remaining: 7000 } });
    const result = evaluateBuiltinCondition({ type: 'context_length', operator: 'gt', value: 2000 }, ctx);
    expect(result.active).toBe(true);
  });

  it('does not activate when remaining is below threshold', () => {
    const ctx = baseCtx({ token_budget: { total: 8192, used: 7000, remaining: 500 } });
    const result = evaluateBuiltinCondition({ type: 'context_length', operator: 'gt', value: 2000 }, ctx);
    expect(result.active).toBe(false);
  });

  it('gte: activates at equality', () => {
    const ctx = baseCtx({ token_budget: { total: 8192, used: 6192, remaining: 2000 } });
    const result = evaluateBuiltinCondition({ type: 'context_length', operator: 'gte', value: 2000 }, ctx);
    expect(result.active).toBe(true);
  });

  it('lt: activates when remaining is less than threshold', () => {
    const ctx = baseCtx({ token_budget: { total: 8192, used: 8000, remaining: 192 } });
    const result = evaluateBuiltinCondition({ type: 'context_length', operator: 'lt', value: 500 }, ctx);
    expect(result.active).toBe(true);
  });

  it('eq: activates when remaining equals threshold', () => {
    const ctx = baseCtx({ token_budget: { total: 8192, used: 6192, remaining: 2000 } });
    const result = evaluateBuiltinCondition({ type: 'context_length', operator: 'eq', value: 2000 }, ctx);
    expect(result.active).toBe(true);
  });
});

// ── evaluateConversationTurn ──

describe('evaluateConversationTurn', () => {
  it('activates when turn_count is above threshold', () => {
    const ctx = baseCtx({ conversation_meta: { turn_count: 10 } });
    const result = evaluateBuiltinCondition({ type: 'conversation_turn', operator: 'gt', value: 3 }, ctx);
    expect(result.active).toBe(true);
  });

  it('does not activate when turn_count is below threshold', () => {
    const ctx = baseCtx({ conversation_meta: { turn_count: 1 } });
    const result = evaluateBuiltinCondition({ type: 'conversation_turn', operator: 'gt', value: 3 }, ctx);
    expect(result.active).toBe(false);
  });

  it('gte: activates at equality', () => {
    const ctx = baseCtx({ conversation_meta: { turn_count: 3 } });
    const result = evaluateBuiltinCondition({ type: 'conversation_turn', operator: 'gte', value: 3 }, ctx);
    expect(result.active).toBe(true);
  });

  it('eq: activates when turn_count equals threshold', () => {
    const ctx = baseCtx({ conversation_meta: { turn_count: 0 } });
    const result = evaluateBuiltinCondition({ type: 'conversation_turn', operator: 'eq', value: 0 }, ctx);
    expect(result.active).toBe(true);
  });
});

// ── custom condition (builtin dispatch) ──

describe('custom condition (builtin)', () => {
  it('returns active placeholder for custom type (use evaluateCustomCondition for Phase 5)', () => {
    const ctx = baseCtx();
    const result = evaluateBuiltinCondition({ type: 'custom', evaluator_key: 'some_plugin' }, ctx);
    expect(result.active).toBe(true);
    expect(result.reason).toContain('evaluateCustomCondition');
  });
});

// ── evaluateCustomCondition (Phase 5 plugin registry) ──

describe('evaluateCustomCondition', () => {
  afterEach(() => {
    slotConditionRegistry.clear();
  });

  it('calls registered plugin evaluator', async () => {
    slotConditionRegistry.register('test-pack', {
      key: 'slot_condition.my_test',
      version: '1.0.0',
      evaluate: async (ctx) => ({
        active: true,
        reason: `evaluated: ${ctx.last_user_message}`,
        confidence: 0.95
      })
    });

    const ctx = baseCtx({ last_user_message: 'hello world' });
    const result = await evaluateCustomCondition('test-pack', 'slot_condition.my_test', ctx);

    expect(result.active).toBe(true);
    expect(result.reason).toBe('evaluated: hello world');
    expect(result.confidence).toBe(0.95);
  });

  it('returns inactive when evaluator not found', async () => {
    const ctx = baseCtx();
    const result = await evaluateCustomCondition('test-pack', 'slot_condition.missing', ctx);

    expect(result.active).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('returns inactive when pack not found', async () => {
    const ctx = baseCtx();
    const result = await evaluateCustomCondition('no-pack', 'slot_condition.any', ctx);

    expect(result.active).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('handles evaluator that throws', async () => {
    slotConditionRegistry.register('test-pack', {
      key: 'slot_condition.broken',
      version: '1.0.0',
      evaluate: async () => {
        throw new Error('evaluation exploded');
      }
    });

    const ctx = baseCtx();
    const result = await evaluateCustomCondition('test-pack', 'slot_condition.broken', ctx);

    expect(result.active).toBe(false);
    expect(result.reason).toContain('evaluation exploded');
  });

  it('per-pack isolation: different packs have different evaluators', async () => {
    slotConditionRegistry.register('pack-a', {
      key: 'slot_condition.same_key',
      version: '1.0.0',
      evaluate: async () => ({ active: true, reason: 'pack-a version' })
    });
    slotConditionRegistry.register('pack-b', {
      key: 'slot_condition.same_key',
      version: '1.0.0',
      evaluate: async () => ({ active: false, reason: 'pack-b version' })
    });

    const ctx = baseCtx();
    const resultA = await evaluateCustomCondition('pack-a', 'slot_condition.same_key', ctx);
    const resultB = await evaluateCustomCondition('pack-b', 'slot_condition.same_key', ctx);

    expect(resultA.active).toBe(true);
    expect(resultA.reason).toBe('pack-a version');
    expect(resultB.active).toBe(false);
    expect(resultB.reason).toBe('pack-b version');
  });
});
