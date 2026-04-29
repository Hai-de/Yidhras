import type { AppInfrastructure } from '../../app/context.js';
import { packEntityIdFromResolvedAgentId } from '../../inference/context_builder.js';
import { listPackAuthorityGrants } from '../../packs/storage/authority_repo.js';
import { listPackEntityStates } from '../../packs/storage/entity_state_repo.js';
import { listPackMediatorBindings } from '../../packs/storage/mediator_repo.js';

export interface ResolvedCapabilityItem {
  capability_key: string;
  grant_type: string;
  source_entity_id: string;
  mediated_by_entity_id: string | null;
  target_selector: Record<string, unknown>;
  conditions: Record<string, unknown> | null;
  priority: number;
  provenance: {
    authority_id: string;
    source_entity_id: string;
    mediated_by_entity_id: string | null;
    matched_via: 'direct_actor_ref' | 'holder_of' | 'subject_entity';
  };
}

export interface AuthorityResolutionResult {
  subject_entity_id: string | null;
  resolved_capabilities: ResolvedCapabilityItem[];
  blocked_authority_ids: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const matchesConditions = (
  actorState: Record<string, unknown> | null,
  conditions: Record<string, unknown> | null | undefined
): boolean => {
  if (!conditions || Object.keys(conditions).length === 0) {
    return true;
  }
  if (!actorState) {
    return false;
  }

  for (const [key, expected] of Object.entries(conditions)) {
    if (!key.startsWith('subject_state.')) {
      continue;
    }
    const stateKey = key.slice('subject_state.'.length);
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
    if (actorState[stateKey] !== expected) {
      return false;
    }
  }

  return true;
};

const findActorState = async (context: AppInfrastructure, packId: string, subjectEntityId: string | null): Promise<Record<string, unknown> | null> => {
  if (!subjectEntityId) {
    return null;
  }
  const states = await listPackEntityStates(context.packStorageAdapter, packId);
  const candidateIds = [subjectEntityId];
  const packEntityId = packEntityIdFromResolvedAgentId(packId, subjectEntityId);
  if (packEntityId && packEntityId !== subjectEntityId) {
    candidateIds.push(packEntityId);
  }
  const actorState = states.find(state => candidateIds.includes(state.entity_id) && state.state_namespace === 'core') ?? null;
  return actorState?.state_json ?? null;
};

const resolveTargetSelectorMatch = async (
  context: AppInfrastructure,
  packId: string,
  subjectEntityId: string | null,
  targetSelector: Record<string, unknown>
): Promise<'direct_actor_ref' | 'holder_of' | 'subject_entity' | null> => {
  if (!subjectEntityId || !isRecord(targetSelector)) {
    return null;
  }

  const kind = typeof targetSelector.kind === 'string' ? targetSelector.kind : null;
  if (!kind) {
    return null;
  }

  const candidateEntityIds = [subjectEntityId];
  const packEntityId = packEntityIdFromResolvedAgentId(packId, subjectEntityId);
  if (packEntityId && packEntityId !== subjectEntityId) {
    candidateEntityIds.push(packEntityId);
  }

  if (kind === 'direct_entity') {
    const targetEntityId = typeof targetSelector.entity_id === 'string' ? targetSelector.entity_id : null;
    if (!targetEntityId) return null;
    return candidateEntityIds.includes(targetEntityId) ? 'direct_actor_ref' : null;
  }

  if (kind === 'holder_of' && typeof targetSelector.entity_id === 'string') {
    const states = await listPackEntityStates(context.packStorageAdapter, packId);
    const targetState = states.find(
      state => state.entity_id === targetSelector.entity_id && state.state_namespace === 'core'
    );
    const holderId = targetState?.state_json?.holder_agent_id;
    if (typeof holderId !== 'string') return null;
    return candidateEntityIds.includes(holderId) ? 'holder_of' : null;
  }

  if (kind === 'subject_entity' && typeof targetSelector.identity_id === 'string') {
    const currentIdentityId = (context as AppInfrastructure & { identity?: { id?: string } }).identity?.id;
    return targetSelector.identity_id === currentIdentityId ? 'subject_entity' : null;
  }

  return null;
};

export const resolveAuthorityForSubject = async (
  context: AppInfrastructure,
  input: {
    packId: string;
    subjectEntityId: string | null;
  }
): Promise<AuthorityResolutionResult> => {
  const actorState = await findActorState(context, input.packId, input.subjectEntityId);
  const authorityGrants = await listPackAuthorityGrants(context.packStorageAdapter, input.packId);

  const resolved_capabilities: ResolvedCapabilityItem[] = [];
  const blocked_authority_ids: string[] = [];

  for (const authority of authorityGrants) {
    const matchedVia = await resolveTargetSelectorMatch(
      context,
      input.packId,
      input.subjectEntityId,
      authority.target_selector_json
    );

    if (!matchedVia) {
      blocked_authority_ids.push(authority.id);
      continue;
    }

    if (!matchesConditions(actorState, authority.conditions_json)) {
      blocked_authority_ids.push(authority.id);
      continue;
    }

    resolved_capabilities.push({
      capability_key: authority.capability_key,
      grant_type: authority.grant_type,
      source_entity_id: authority.source_entity_id,
      mediated_by_entity_id: authority.mediated_by_entity_id,
      target_selector: authority.target_selector_json,
      conditions: authority.conditions_json,
      priority: authority.priority,
      provenance: {
        authority_id: authority.id,
        source_entity_id: authority.source_entity_id,
        mediated_by_entity_id: authority.mediated_by_entity_id,
        matched_via: matchedVia
      }
    });
  }

  resolved_capabilities.sort((left, right) => right.priority - left.priority);

  return {
    subject_entity_id: input.subjectEntityId,
    resolved_capabilities,
    blocked_authority_ids
  };
};

export const resolveMediatorBindingsForPack = async (
  _context: AppInfrastructure,
  input: { packId: string }
) => {
  return listPackMediatorBindings(_context.packStorageAdapter, input.packId);
};
