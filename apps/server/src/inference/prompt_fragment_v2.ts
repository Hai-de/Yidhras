import type { PromptBlock } from './prompt_block.js';

export type PromptFragmentPlacementMode = 'prepend' | 'append' | 'before_anchor' | 'after_anchor';
export type PromptFragmentAnchorKind = 'slot_start' | 'slot_end' | 'source' | 'tag' | 'fragment_id';

export interface PromptFragmentAnchor {
  kind: PromptFragmentAnchorKind;
  value: string;
}

/**
 * Fragment 是 Slot 内部的中间节点。
 * 可以是 Block 的容器，也可以嵌套其他 Fragment。
 * 类比 AST 中的非叶子节点：分组、排序、锚定。
 */
export interface PromptFragmentV2 {
  /** 唯一标识 */
  id: string;
  /** 所属 Slot 的 id */
  slot_id: string;
  /** 优先级（同 slot 内排序用，数值越大越靠前） */
  priority: number;
  /** 来源标识（如 'system.core'、'world_prompts.global_prefix'） */
  source: string;
  /** 是否可被 budget trimming 移除 */
  removable: boolean;
  /** 是否可被同名 source 的 fragment 替换 */
  replaceable: boolean;

  /** 子节点：Block 或嵌套 Fragment */
  children: Array<PromptBlock | PromptFragmentV2>;

  // --- 放置语义 ---
  anchor?: PromptFragmentAnchor | null;
  placement_mode?: PromptFragmentPlacementMode | null;
  depth?: number | null;
  order?: number | null;

  // --- 权限标记（实验性） ---
  permissions?: PromptFragmentPermissions | null;

  /** 权限检查后被标记（true = 不可渲染） */
  permission_denied?: boolean;
  /** 聚合所有子 Block 的 estimated_tokens 之和 */
  estimated_tokens?: number;
  /** 拒绝原因（调试用） */
  denied_reason?: string | null;

  metadata?: Record<string, unknown>;
}

/**
 * Fragment 级别的权限声明。
 * 该 fragment 及其所有子 Block 继承此权限。
 * 仅在 features.experimental.prompt_slot_permissions 启用时生效。
 */
export interface PromptFragmentPermissions {
  /** 允许读取内容的主体 id 列表（host_agent / agent:xxx） */
  read?: string[];
  /** @unimplemented 允许创建/注入子节点的主体 id 列表（执行逻辑尚未实现，仅类型占位） */
  write?: string[];
  /** @unimplemented 允许调整优先级/顺序/锚点的主体 id 列表（执行逻辑尚未实现，仅类型占位） */
  adjust?: string[];
  /** 该 fragment 在最终 prompt 中是否可见 */
  visible: boolean;
  /** 可见性 checker：无 → 始终可见；有 → 需匹配主体才会渲染到 combined_prompt */
  visible_to?: string[];
}
