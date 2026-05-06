import type { PromptFragmentPermissions } from './prompt_fragment_v2.js';

/**
 * Slot identifier used to categorize prompt fragments by role.
 * Shared across both slot configuration and fragment placement.
 */
/** 插槽标识符。Phase 4 起由闭合联合类型开放为 string，支持动态注册插槽。 */
export type PromptFragmentSlot = string;

/**
 * 单个 Slot 的声明式配置。
 * 来自 YAML 配置文件（如 prompt_slots.yaml）或 World Pack 的 pack.ai.slots。
 */
/** 插槽级相对定位锚点 */
export interface SlotAnchor {
  /** 参照插槽 id（必须存在于位置图中，包括禁用插槽） */
  ref: string;
  /** 相对关系 */
  relation: 'after' | 'before';
}

/** 插槽定位解析结果（内部使用，不持久化） */
export interface ResolvedSlotPosition {
  slot_id: string;
  /** 解析后的绝对位置数值，用于排序 */
  resolved_position: number;
  /**
   * 解析来源：
   * - 'explicit': position 字段显式指定
   * - 'anchor': 由 anchor.ref 计算
   * - 'default': 降级为 default_priority
   */
  resolution_source: 'explicit' | 'anchor' | 'default';
  /** 插槽是否启用（不参与内容渲染，但保留定位） */
  enabled: boolean;
}

/** 解析诊断信息 */
export interface SlotPositionDiagnostics {
  warnings: Array<{
    slot_id: string;
    code: 'anchor_ref_not_found' | 'anchor_cycle_detected' | 'position_collision';
    message: string;
    fallback_position: number;
  }>;
  resolution_map: Array<{
    slot_id: string;
    resolved_position: number;
    source: 'explicit' | 'anchor' | 'default';
  }>;
}

export interface PromptSlotConfig {
  id: string;
  display_name: string;
  description?: string;
  default_priority: number;

  /**
   * 绝对位置数值。决定插槽在组合提示词中的排列顺序。
   * 数值越大越靠前。内置插槽默认使用 10 的倍数（100, 90, 80...）以预留插入空间。
   *
   * 向后兼容：若未指定，回退到 default_priority 的值。
   * 优先级低于 anchor（当 anchor 被指定时，anchor 解析结果覆盖 position）。
   */
  position?: number | null;

  /**
   * 相对定位锚点。声明式语法：此插槽排在 ref 插槽的 after/before 方向。
   * 优先级高于 position：当 anchor 被指定时，解析器根据 ref 插槽的实际位置计算本插槽的 resolved_position。
   *
   * 若 ref 插槽不存在，降级为 position → default_priority 排序，并写入 diagnostics。
   */
  anchor?: SlotAnchor | null;

  default_template?: string | null;
  template_context?: 'inference' | 'world_prompts' | 'pack_state' | 'none';
  message_role?: 'system' | 'developer' | 'user';
  include_in_combined: boolean;
  combined_heading?: string | null;
  permissions?: PromptFragmentPermissions | null;

  /**
   * 插槽启用状态。
   *
   * 语义变更：enabled=false 时，插槽仍然存在于位置图中——
   * 其他插槽的 anchor.ref 可以引用它（它仍有 resolved_position）；
   * 但渲染时跳过内容产出（不纳入 combined_prompt、不参与 message assembly）。
   */
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface PromptSlotRegistry {
  version: number;
  slots: Record<string, PromptSlotConfig>;
  metadata?: PromptSlotRegistryMetadata;
}

export interface PromptSlotRegistryMetadata {
  workspace_root?: string;
  config_path?: string;
  loaded_from_file?: boolean;
}
