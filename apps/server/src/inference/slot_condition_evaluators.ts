import type { SlotLogicExpr } from './slot_behavior.js';

/**
 * 条件输入类型 — 与 config/domains/slot_behavior.ts 的 Zod schema 对齐。
 * logic_match.expression 在配置加载时为 Record<string, unknown>，
 * 评估时内部 cast 到 SlotLogicExpr。
 */
export type SlotConditionInput =
  | { type: 'keyword_match'; keywords: string[]; match_mode?: 'any' | 'all' }
  | { type: 'logic_match'; expression: Record<string, unknown> }
  | { type: 'context_length'; operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq'; value: number }
  | { type: 'conversation_turn'; operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq'; value: number }
  | { type: 'custom'; evaluator_key: string; options?: Record<string, unknown> };

/**
 * 条件评估上下文 — 行为控制执行器在执行时组装。
 */
export interface SlotConditionContext {
  slot_id: string;
  variables: Record<string, unknown>;
  conversation_meta: {
    turn_count: number;
    last_message_role?: string;
  };
  token_budget: {
    total: number;
    used: number;
    remaining: number;
  };
  current_tick: number;
  last_user_message: string;
  options?: Record<string, unknown>;
}

/**
 * 条件评估结果。
 */
export interface SlotConditionResult {
  active: boolean;
  reason?: string;
  confidence?: number;
}

const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * 解析点分路径 + 数组索引。
 * 例：'a.b[0].c' → 从 obj 中提取 obj.a.b[0].c。
 */
export function resolveDotPath(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    const arrayMatch = segment.match(/^(\w+)\[(-?\d+)\]$/);
    if (arrayMatch) {
      const key = arrayMatch[1];
      const index = parseInt(arrayMatch[2], 10);
      if (FORBIDDEN_PATH_SEGMENTS.has(key)) {
        return undefined;
      }
      const record = current as Record<string, unknown>;
      // eslint-disable-next-line security/detect-object-injection
      const arr = record[key];
      if (!Array.isArray(arr)) {
        return undefined;
      }
      const resolvedIndex = index < 0 ? arr.length + index : index;
      current = arr[resolvedIndex];
    } else {
      if (FORBIDDEN_PATH_SEGMENTS.has(segment)) {
        return undefined;
      }
      const record = current as Record<string, unknown>;
      // eslint-disable-next-line security/detect-object-injection
      current = record[segment];
    }
  }

  return current;
}

/**
 * 解析含通配符 `*` 的点分路径，返回所有匹配的值。
 * `*` 匹配当前层级的所有 key（跳过原型链和禁止段）。
 * 路径不含 `*` 时行为等价于 resolveDotPath，但返回数组。
 *
 * 例：'items.*.name' → 遍历 items 的所有子对象，收集每个 .name
 */
export function resolveWildcardPaths(obj: Record<string, unknown>, path: string): unknown[] {
  const segments = path.split('.');

  function walk(current: unknown, segIndex: number): unknown[] {
    if (current === null || current === undefined) {
      return [];
    }
    if (segIndex >= segments.length) {
      return [current];
    }

    const segment = segments[segIndex];

    // 通配符 — 展开当前对象的所有 key
    if (segment === '*') {
      if (typeof current !== 'object' || Array.isArray(current)) {
        return [];
      }
      const record = current as Record<string, unknown>;
      const results: unknown[] = [];
      for (const key of Object.keys(record)) {
        if (FORBIDDEN_PATH_SEGMENTS.has(key)) continue;
        // eslint-disable-next-line security/detect-object-injection
        results.push(...walk(record[key], segIndex + 1));
      }
      return results;
    }

    // 数组索引: key[N]
    const arrayMatch = segment.match(/^(\w+)\[(-?\d+)\]$/);
    if (arrayMatch) {
      const key = arrayMatch[1];
      if (FORBIDDEN_PATH_SEGMENTS.has(key)) return [];
      const index = parseInt(arrayMatch[2], 10);
      const record = current as Record<string, unknown>;
      // eslint-disable-next-line security/detect-object-injection
      const arr = record[key];
      if (!Array.isArray(arr)) return [];
      const resolvedIndex = index < 0 ? arr.length + index : index;
      return walk(arr[resolvedIndex], segIndex + 1);
    }

    // 普通 key
    if (FORBIDDEN_PATH_SEGMENTS.has(segment)) return [];
    const record = current as Record<string, unknown>;
    // eslint-disable-next-line security/detect-object-injection
    return walk(record[segment], segIndex + 1);
  }

  return walk(obj, 0);
}

/**
 * 判断路径是否包含通配符。
 */
function hasWildcard(path: string): boolean {
  return path.split('.').some((seg) => seg === '*');
}

function compareValue(
  a: unknown,
  op: 'gt' | 'lt' | 'gte' | 'lte' | 'eq',
  b: unknown
): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    switch (op) {
      case 'gt':
        return a > b;
      case 'lt':
        return a < b;
      case 'gte':
        return a >= b;
      case 'lte':
        return a <= b;
      case 'eq':
        return a === b;
    }
  }

  if (typeof a === 'string' && typeof b === 'string') {
    switch (op) {
      case 'eq':
        return a === b;
      default:
        return false;
    }
  }

  if (typeof a === 'boolean' && typeof b === 'boolean') {
    if (op === 'eq') {
      return a === b;
    }
    return false;
  }

  if (a === null && b === null && op === 'eq') {
    return true;
  }

  return false;
}

/**
 * 递归求值 SlotLogicExpr。
 * 路径含 `*` 时使用 ANY 语义：展开所有匹配路径，至少一个满足条件即为 true。
 * 安全约束：禁止原型链访问，3s 超时（由调用方 AbortController 控制）。
 */
export function evaluateSlotLogicExpr(
  expr: SlotLogicExpr,
  variables: Record<string, unknown>,
  signal?: AbortSignal
): boolean {
  if (signal?.aborted) {
    return false;
  }

  if ('eq' in expr) {
    if (hasWildcard(expr.eq.path)) {
      return resolveWildcardPaths(variables, expr.eq.path).some((v) => v === expr.eq.value);
    }
    return resolveDotPath(variables, expr.eq.path) === expr.eq.value;
  }
  if ('neq' in expr) {
    if (hasWildcard(expr.neq.path)) {
      return resolveWildcardPaths(variables, expr.neq.path).every((v) => v !== expr.neq.value);
    }
    return resolveDotPath(variables, expr.neq.path) !== expr.neq.value;
  }
  if ('gt' in expr) {
    if (hasWildcard(expr.gt.path)) {
      return resolveWildcardPaths(variables, expr.gt.path).some((v) => compareValue(v, 'gt', expr.gt.value));
    }
    return compareValue(resolveDotPath(variables, expr.gt.path), 'gt', expr.gt.value);
  }
  if ('lt' in expr) {
    if (hasWildcard(expr.lt.path)) {
      return resolveWildcardPaths(variables, expr.lt.path).some((v) => compareValue(v, 'lt', expr.lt.value));
    }
    return compareValue(resolveDotPath(variables, expr.lt.path), 'lt', expr.lt.value);
  }
  if ('gte' in expr) {
    if (hasWildcard(expr.gte.path)) {
      return resolveWildcardPaths(variables, expr.gte.path).some((v) => compareValue(v, 'gte', expr.gte.value));
    }
    return compareValue(resolveDotPath(variables, expr.gte.path), 'gte', expr.gte.value);
  }
  if ('lte' in expr) {
    if (hasWildcard(expr.lte.path)) {
      return resolveWildcardPaths(variables, expr.lte.path).some((v) => compareValue(v, 'lte', expr.lte.value));
    }
    return compareValue(resolveDotPath(variables, expr.lte.path), 'lte', expr.lte.value);
  }
  if ('contains' in expr) {
    if (hasWildcard(expr.contains.path)) {
      return resolveWildcardPaths(variables, expr.contains.path).some(
        (v) => typeof v === 'string' && v.includes(expr.contains.value)
      );
    }
    const value = resolveDotPath(variables, expr.contains.path);
    return typeof value === 'string' && value.includes(expr.contains.value);
  }
  if ('exists' in expr) {
    if (hasWildcard(expr.exists.path)) {
      return resolveWildcardPaths(variables, expr.exists.path).length > 0;
    }
    const value = resolveDotPath(variables, expr.exists.path);
    return value !== undefined && value !== null;
  }
  if ('and' in expr) {
    return expr.and.every((subExpr) => evaluateSlotLogicExpr(subExpr, variables, signal));
  }
  if ('or' in expr) {
    return expr.or.some((subExpr) => evaluateSlotLogicExpr(subExpr, variables, signal));
  }
  if ('not' in expr) {
    return !evaluateSlotLogicExpr(expr.not, variables, signal);
  }

  return false;
}

/**
 * 关键字匹配条件 — 从 context.last_user_message 取文本。
 * 空文本直接返回 false。
 */
export function evaluateKeywordMatch(
  condition: { keywords: string[]; match_mode?: 'any' | 'all' },
  context: SlotConditionContext
): SlotConditionResult {
  const text = context.last_user_message;
  if (!text) {
    return { active: false, reason: 'last_user_message is empty' };
  }

  const matchMode = condition.match_mode ?? 'any';
  const matchFn = matchMode === 'all' ? 'every' : 'some';
  const matched = condition.keywords[matchFn]((kw: string) => text.includes(kw));

  return {
    active: matched,
    reason: matched
      ? `keyword_match (${matchMode}): matched`
      : `keyword_match (${matchMode}): no match`
  };
}

/**
 * Logic DSL 条件求值。
 * 使用 AbortController 实现 3s 超时。
 */
export function evaluateLogicMatch(
  condition: { expression: Record<string, unknown> },
  context: SlotConditionContext
): SlotConditionResult {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const mergedVars: Record<string, unknown> = {
      ...context.variables,
      conversation: context.conversation_meta,
      token_budget: context.token_budget,
      current_tick: context.current_tick
    };

    // YAML 配置加载后 expression 为 Record<string, unknown>，内部 cast 到 SlotLogicExpr
    const expr = condition.expression as unknown as SlotLogicExpr;
    const active = evaluateSlotLogicExpr(expr, mergedVars, controller.signal);
    return {
      active,
      reason: active ? 'logic_match: expression satisfied' : 'logic_match: expression not satisfied'
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      active: false,
      reason: `logic_match error: ${message}`
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 上下文长度条件 — 对比 token_budget.remaining 与阈值。
 */
export function evaluateContextLength(
  condition: { operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq'; value: number },
  context: SlotConditionContext
): SlotConditionResult {
  const active = compareValue(context.token_budget.remaining, condition.operator, condition.value);
  return {
    active,
    reason: active
      ? `context_length: remaining ${context.token_budget.remaining} ${condition.operator} ${condition.value}`
      : `context_length: remaining ${context.token_budget.remaining} not ${condition.operator} ${condition.value}`
  };
}

/**
 * 对话轮次条件 — 对比 conversation_meta.turn_count 与阈值。
 */
export function evaluateConversationTurn(
  condition: { operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq'; value: number },
  context: SlotConditionContext
): SlotConditionResult {
  const active = compareValue(
    context.conversation_meta.turn_count,
    condition.operator,
    condition.value
  );
  return {
    active,
    reason: active
      ? `conversation_turn: turn_count ${context.conversation_meta.turn_count} ${condition.operator} ${condition.value}`
      : `conversation_turn: turn_count ${context.conversation_meta.turn_count} not ${condition.operator} ${condition.value}`
  };
}

/**
 * 内置条件评估调度 — 根据条件类型分派到对应的评估函数。
 */
export function evaluateBuiltinCondition(
  condition: SlotConditionInput,
  context: SlotConditionContext
): SlotConditionResult {
  switch (condition.type) {
    case 'keyword_match':
      return evaluateKeywordMatch(condition, context);
    case 'logic_match':
      return evaluateLogicMatch(condition, context);
    case 'context_length':
      return evaluateContextLength(condition, context);
    case 'conversation_turn':
      return evaluateConversationTurn(condition, context);
    case 'custom':
      return {
        active: true,
        reason: 'custom evaluator — use evaluateCustomCondition for Phase 5 plugin support'
      };
  }
}

/**
 * 自定义条件评估 — 通过插件注册表查找并调用外部评估器。
 * Phase 5: 支持 per-pack 注册的自定义 SlotConditionEvaluator。
 *
 * @param packId 当前世界包 ID（用于 per-pack 注册表查询）
 * @param evaluatorKey 插件注册的 evaluator key（如 'slot_condition.my_eval'）
 * @param context 条件评估上下文
 * @param timeoutMs 超时（默认 3000ms）
 */
export async function evaluateCustomCondition(
  packId: string,
  evaluatorKey: string,
  context: SlotConditionContext,
  timeoutMs = 3000
): Promise<SlotConditionResult> {
  // 动态导入避免循环依赖（slot_condition_registry 在 plugins/extensions/ 下）
  const { slotConditionRegistry } = await import(
    '../plugins/extensions/slot_condition_registry.js'
  );

  const evaluator = slotConditionRegistry.get(packId, evaluatorKey);
  if (!evaluator) {
    return {
      active: false,
      reason: `custom evaluator '${evaluatorKey}' not found in pack '${packId}'`
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await evaluator.evaluate(context);
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      active: false,
      reason: `custom evaluator '${evaluatorKey}' error: ${message}`
    };
  } finally {
    clearTimeout(timeout);
  }
}
