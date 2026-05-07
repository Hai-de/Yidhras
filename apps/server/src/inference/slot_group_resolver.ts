import type { SlotBehaviorProfile } from './slot_behavior.js';

/**
 * 群组解析结果。
 */
export interface SlotGroupResult {
  /** 按 group_id 分组的插槽配置 */
  groups: Map<string, SlotBehaviorProfile[]>;
  /** 未被分组的独立插槽 */
  ungrouped: SlotBehaviorProfile[];
}

/**
 * 将 slot behavior profiles 按 group_id 分组。
 */
export function resolveSlotGroups(profiles: SlotBehaviorProfile[]): SlotGroupResult {
  const groups = new Map<string, SlotBehaviorProfile[]>();
  const ungrouped: SlotBehaviorProfile[] = [];

  for (const profile of profiles) {
    if (profile.group_id) {
      const existing = groups.get(profile.group_id) ?? [];
      existing.push(profile);
      groups.set(profile.group_id, existing);
    } else {
      ungrouped.push(profile);
    }
  }

  return { groups, ungrouped };
}

/**
 * 互斥选择：按权重概率选择一个插槽激活，其余禁用。
 * 使用确定性种子保证可重现。
 * Phase 4 默认 group_mode 为 'exclusive'。
 *
 * @param groupProfiles 同组的插槽配置列表
 * @param seed 确定性种子（如 inference_id + group_id）
 * @returns 被选中的插槽 slot_id，其余应禁用
 */
export function resolveExclusiveGroup(
  groupProfiles: SlotBehaviorProfile[],
  seed: string
): string | null {
  if (groupProfiles.length === 0) {
    return null;
  }

  if (groupProfiles.length === 1) {
    return groupProfiles[0].slot_id;
  }

  // 计算总权重
  let totalWeight = 0;
  for (const profile of groupProfiles) {
    totalWeight += profile.group_weight ?? 1;
  }

  if (totalWeight <= 0) {
    return null;
  }

  // 确定性采样：使用 FNV-1a 哈希映射到 [0, totalWeight)
  const hash = fnv1a32(seed);
  const roll = (hash % (totalWeight * 1000)) / 1000;

  let cumulative = 0;
  for (const profile of groupProfiles) {
    cumulative += profile.group_weight ?? 1;
    if (roll < cumulative) {
      return profile.slot_id;
    }
  }

  // 回退：选最后一个
  return groupProfiles[groupProfiles.length - 1].slot_id;
}

/**
 * 按权重降序排列插槽（priority 模式）。
 */
export function resolvePriorityOrder(
  groupProfiles: SlotBehaviorProfile[]
): SlotBehaviorProfile[] {
  return [...groupProfiles].sort((a, b) => (b.group_weight ?? 1) - (a.group_weight ?? 1));
}

/**
 * 按权重分配 token 预算（budget 模式）。
 */
export function resolveBudgetAllocation(
  groupProfiles: SlotBehaviorProfile[],
  totalBudget: number
): Map<string, number> {
  const allocations = new Map<string, number>();
  const totalWeight = groupProfiles.reduce((sum, p) => sum + (p.group_weight ?? 1), 0);

  if (totalWeight <= 0) {
    return allocations;
  }

  for (const profile of groupProfiles) {
    const share = (profile.group_weight ?? 1) / totalWeight;
    allocations.set(profile.slot_id, Math.floor(totalBudget * share));
  }

  return allocations;
}

// ── FNV-1a 32-bit helper ──

function fnv1a32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
    hash = hash >>> 0;
  }
  return hash;
}
