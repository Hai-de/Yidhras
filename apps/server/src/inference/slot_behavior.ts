import type { RuntimeConfig } from '../config/domains/index.js';
import type { SlotBehaviorConfig, SlotBehaviorProfile } from '../config/domains/slot_behavior.js';

/**
 * logic_match 条件的 DSL 表达式类型。
 * 对齐 memory_trigger_sidecar/src/logic_dsl.rs 的 MemoryLogicExprDto。
 * Phase 1 路径解析支持点分路径 + 数组索引，通配符延后。
 * 安全约束：禁止访问原型链属性（__proto__, constructor 等）。
 */
export type SlotLogicExpr =
  | { eq: { path: string; value: string | number | boolean | null } }
  | { neq: { path: string; value: string | number | boolean | null } }
  | { gt: { path: string; value: number } }
  | { lt: { path: string; value: number } }
  | { gte: { path: string; value: number } }
  | { lte: { path: string; value: number } }
  | { contains: { path: string; value: string } }
  | { exists: { path: string } }
  | { and: SlotLogicExpr[] }
  | { or: SlotLogicExpr[] }
  | { not: SlotLogicExpr };

export type SlotCondition =
  | { type: 'keyword_match'; keywords: string[]; match_mode?: 'any' | 'all' }
  | { type: 'logic_match'; expression: SlotLogicExpr }
  | { type: 'context_length'; operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq'; value: number }
  | { type: 'conversation_turn'; operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq'; value: number }
  | { type: 'custom'; evaluator_key: string; options?: Record<string, unknown> };

// Re-export config domain types for convenience
export type { SlotBehaviorProfile } from '../config/domains/slot_behavior.js';

/**
 * 从 RuntimeConfig 提取插槽行为配置。
 */
export function loadSlotBehaviorConfig(runtimeConfig: RuntimeConfig): SlotBehaviorConfig {
  return runtimeConfig.slot_behaviors ?? {};
}

/**
 * 按 slot_id 查找行为配置，未找到返回 undefined。
 */
export function getBehaviorProfile(
  slotId: string,
  config: SlotBehaviorConfig
): SlotBehaviorProfile | undefined {
  // eslint-disable-next-line security/detect-object-injection
  return config[slotId];
}

/**
 * 验证行为配置的语义约束。
 * 返回错误消息数组，空数组表示配置合法。
 */
export function validateSlotBehaviorConfig(config: SlotBehaviorConfig): string[] {
  const errors: string[] = [];

  for (const [slotId, profile] of Object.entries(config)) {
    if (profile.always_active && profile.conditions && profile.conditions.length > 0) {
      errors.push(
        `slot_behaviors.${slotId}: always_active + conditions 冲突 — 同时声明为配置错误`
      );
    }

    if (profile.always_active && profile.group_id) {
      errors.push(
        `slot_behaviors.${slotId}: always_active + group_id 冲突 — 同时声明为配置错误`
      );
    }
  }

  return errors;
}
