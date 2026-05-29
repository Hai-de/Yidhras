import type { AppInfrastructure } from '../../app/context.js';
import {
  type AuthorityResolutionResult,
  resolveAuthorityForSubject} from '../../domain/authority/resolver.js';
import { packEntityIdFromResolvedAgentId } from '../../packs/utils/pack_entity_id.js';

export interface AuthorityAdapterResult {
  capabilities: string[];
  fullResult: AuthorityResolutionResult;
}

/**
 * 薄包装层，封装对 domain/authority 的调用。
 * 一次调用返回完整结果 + 提取的 capability keys。
 */
export const resolveAuthority = async (
  context: AppInfrastructure,
  packId: string,
  resolvedAgentId: string | null
): Promise<AuthorityAdapterResult> => {
  const subjectEntityId = resolvedAgentId
    ? packEntityIdFromResolvedAgentId(packId, resolvedAgentId)
    : null;

  const fullResult = await resolveAuthorityForSubject(context, {
    packId,
    subjectEntityId
  });

  return {
    capabilities: fullResult.resolved_capabilities.map((c) => c.capability_key),
    fullResult
  };
};
