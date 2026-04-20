import type { AppContext } from '../../../app/context.js';
import { listPackAuthorityGrants } from '../../storage/authority_repo.js';
import { listPackWorldEntities } from '../../storage/entity_repo.js';
import { listPackEntityStates } from '../../storage/entity_state_repo.js';
import { listPackMediatorBindings } from '../../storage/mediator_repo.js';
import { listPackRuleExecutionRecords } from '../../storage/rule_execution_repo.js';
import { resolvePackProjectionTarget } from './active_pack_projection_guard.js';

export interface PackEntityProjectionSnapshot {
  pack: {
    id: string;
    name: string;
    version: string;
  };
  summary: {
    entity_count: number;
    actor_count: number;
    artifact_count: number;
    authority_count: number;
    mediator_binding_count: number;
    rule_execution_count: number;
  };
  entities: Array<{
    id: string;
    entity_kind: string;
    entity_type: string | null;
    label: string;
    tags: string[];
    state: Array<{
      namespace: string;
      value: Record<string, unknown>;
    }>;
  }>;
  authorities: Array<{
    id: string;
    capability_key: string;
    grant_type: string;
    source_entity_id: string;
    mediated_by_entity_id: string | null;
    status: string | null;
    priority: number;
  }>;
  mediator_bindings: Array<{
    id: string;
    mediator_id: string;
    subject_entity_id: string | null;
    binding_kind: string;
    status: string;
  }>;
  recent_rule_executions: Array<{
    id: string;
    rule_id: string;
    capability_key: string | null;
    mediator_id: string | null;
    subject_entity_id: string | null;
    target_entity_id: string | null;
    execution_status: string;
    created_at: string;
  }>;
}

export interface PackProjectionMetadataSnapshot {
  id: string;
  name: string;
  version: string;
}

const extractEntityIdFromWorldEntityRecordId = (packId: string, recordId: string): string => {
  const prefix = `${packId}:entity:`;
  return recordId.startsWith(prefix) ? recordId.slice(prefix.length) : recordId;
};

export const buildPackEntityOverviewProjection = async (
  context: AppContext,
  input: {
    packId: string;
    pack: PackProjectionMetadataSnapshot;
  }
): Promise<PackEntityProjectionSnapshot> => {
  const [entities, entityStates, authorities, mediatorBindings, ruleExecutions] = await Promise.all([
    listPackWorldEntities(input.packId),
    listPackEntityStates(input.packId),
    listPackAuthorityGrants(input.packId),
    listPackMediatorBindings(input.packId),
    listPackRuleExecutionRecords(input.packId)
  ]);

  return {
    pack: {
      id: input.pack.id,
      name: input.pack.name,
      version: input.pack.version
    },
    summary: {
      entity_count: entities.length,
      actor_count: entities.filter(entity => entity.entity_kind === 'actor').length,
      artifact_count: entities.filter(entity => entity.entity_kind === 'artifact').length,
      authority_count: authorities.length,
      mediator_binding_count: mediatorBindings.length,
      rule_execution_count: ruleExecutions.length
    },
    entities: entities.map(entity => {
      const entityId = extractEntityIdFromWorldEntityRecordId(input.packId, entity.id);
      return {
        id: entityId,
        entity_kind: entity.entity_kind,
        entity_type: entity.entity_type,
        label: entity.label,
        tags: entity.tags,
        state: entityStates
          .filter(state => state.entity_id === entityId)
          .map(state => ({
            namespace: state.state_namespace,
            value: state.state_json
          }))
      };
    }),
    authorities: authorities.map(authority => ({
      id: authority.id,
      capability_key: authority.capability_key,
      grant_type: authority.grant_type,
      source_entity_id: authority.source_entity_id,
      mediated_by_entity_id: authority.mediated_by_entity_id,
      status: authority.status,
      priority: authority.priority
    })),
    mediator_bindings: mediatorBindings.map(binding => ({
      id: binding.id,
      mediator_id: binding.mediator_id,
      subject_entity_id: binding.subject_entity_id,
      binding_kind: binding.binding_kind,
      status: binding.status
    })),
    recent_rule_executions: [...ruleExecutions]
      .sort((left, right) => Number(right.created_at - left.created_at))
      .slice(0, 20)
      .map(record => ({
        id: record.id,
        rule_id: record.rule_id,
        capability_key: record.capability_key,
        mediator_id: record.mediator_id,
        subject_entity_id: record.subject_entity_id,
        target_entity_id: record.target_entity_id,
        execution_status: record.execution_status,
        created_at: record.created_at.toString()
      }))
  };
};

export const getPackEntityOverviewProjection = async (
  context: AppContext,
  packId?: string
): Promise<PackEntityProjectionSnapshot> => {
  const { activePack, resolvedPackId } = resolvePackProjectionTarget(context, {
    requestedPackId: packId,
    feature: 'pack entity overview projection'
  });

  if (!activePack || !resolvedPackId) {
    throw new Error('World pack not ready for pack entity overview projection');
  }

  return buildPackEntityOverviewProjection(context, {
    packId: resolvedPackId,
    pack: {
      id: activePack.metadata.id,
      name: activePack.metadata.name,
      version: activePack.metadata.version
    },
  });
};
