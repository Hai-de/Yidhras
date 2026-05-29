/**
 * 从 impact_data JSON 字符串中提取 `semantic_type` 字段。
 * - impactData 为 null/空 → 返回 null
 * - JSON 解析失败 → 返回 null
 * - 解析结果非普通对象 → 返回 null
 * - semantic_type 非字符串 → 返回 null
 */
export const extractSemanticType = (impactData: string | null): string | null => {
  if (!impactData || impactData.trim().length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(impactData);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const st = (parsed as Record<string, unknown>).semantic_type;
      return typeof st === 'string' ? st : null;
    }
  } catch {
    return null;
  }
  return null;
};
