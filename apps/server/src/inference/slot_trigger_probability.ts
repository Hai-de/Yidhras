/**
 * FNV-1a 64-bit 哈希实现。
 *
 * 与 Rust sidecar 的 memory_trigger_sidecar/src/sampling.rs 算法对齐，
 * 用于确定性 trigger_probability 采样。
 * 交叉验证：与 Rust 输出做快照对比确保一致性。
 *
 * FNV-1a 算法: hash = (hash XOR byte) * FNV_PRIME (mod 2^64)
 * FNV_OFFSET_BASIS = 14695981039346656037n (0xcbf29ce484222325)
 * FNV_PRIME        = 1099511628211n       (0x100000001b3)
 */

const FNV_OFFSET_BASIS = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const U64_MASK = 0xFFFFFFFFFFFFFFFFn;

/**
 * FNV-1a 64-bit 哈希。
 * 返回 bigint，范围 [0, 2^64)。
 */
export function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET_BASIS;

  for (let i = 0; i < input.length; i++) {
     
    hash = hash ^ BigInt(input.charCodeAt(i));
     
    hash = (hash * FNV_PRIME) & U64_MASK;
  }

  return hash;
}

/**
 * 计算 trigger_probability 的确定性采样值。
 * 种子格式：slot_behavior_rate_gate::{slotId}::{currentTick}::{triggerCount}
 * 映射到 [0, 1) 区间。
 */
export function computeTriggerProbabilitySample(
  slotId: string,
  currentTick: number,
  triggerCount: number
): number {
  const seed = `slot_behavior_rate_gate::${slotId}::${currentTick}::${triggerCount}`;
  const hash = fnv1a64(seed);
  // 取低 32 位，除以 2^32，映射到 [0, 1)
  const lower32 = Number(hash & 0xFFFFFFFFn);
  return lower32 / 4294967296;
}

/**
 * 评估 trigger_probability 是否激活。
 * probability >= 1.0 → 始终 true
 * probability <= 0.0 → 始终 false
 * 否则使用 FNV-1a 确定性采样判定。
 */
export function evaluateTriggerProbability(
  probability: number,
  slotId: string,
  currentTick: number,
  triggerCount: number
): boolean {
  if (probability >= 1.0) {
    return true;
  }
  if (probability <= 0.0) {
    return false;
  }
  const sample = computeTriggerProbabilitySample(slotId, currentTick, triggerCount);
  return sample < probability;
}
