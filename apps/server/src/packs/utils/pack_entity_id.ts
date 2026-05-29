export const ACTOR_ENTITY_ID_SEPARATOR = ':';

/**
 * 从 bridged agent ID（`{packId}:{entityId}`）中提取 pack 内的 entity ID。
 * - resolvedAgentId 为 null → 返回 null
 * - resolvedAgentId 以 `{packId}:` 开头 → 返回剥离前缀后的 entity ID
 * - 其他情况 → 返回原值
 */
export const packEntityIdFromResolvedAgentId = (
  packId: string,
  resolvedAgentId: string | null
): string | null => {
  if (!resolvedAgentId) return null;
  const prefix = `${packId}${ACTOR_ENTITY_ID_SEPARATOR}`;
  if (resolvedAgentId.startsWith(prefix)) {
    return resolvedAgentId.slice(prefix.length);
  }
  return resolvedAgentId;
};
