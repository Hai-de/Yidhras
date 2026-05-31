import {
  WORLD_ENGINE_PROTOCOL_VERSION,
  type WorldObjectiveRuleDefinition,
  type WorldObjectiveRuleInvocation,
  type WorldObjectiveWorldEntity,
  type WorldRuleExecuteObjectiveRequest,
  type WorldRuleExecuteObjectiveResult
} from '@yidhras/contracts';

import type { AppInfrastructure } from '../../app/context.js';
import { listPackWorldEntities } from '../../packs/storage/entity_repo.js';
import type { PackStorageAdapter } from '../../packs/storage/PackStorageAdapter.js';
import { ApiError } from '../../utils/api_error.js';
import { isRecord } from '../../utils/type_guards.js';
import type { InvocationRequest } from '../invocation/types.js';

export interface ObjectiveEntityStateMutation {
  kind: 'entity_state';
  entity_id: string;
  state_namespace: string;
  state_patch: Record<string, unknown>;
}

export interface ObjectiveAuthorityGrantMutation {
  kind: 'authority_grant';
  grant_id: string;
  source_entity_id: string;
  target_selector_json: Record<string, unknown>;
  capability_key: string;
  grant_type: string;
  mediated_by_entity_id: string | null;
  scope_json: Record<string, unknown> | null;
  conditions_json: Record<string, unknown> | null;
  priority: number;
  status: string;
  revocable: boolean;
}

export type ObjectiveMutationEffect = ObjectiveEntityStateMutation | ObjectiveAuthorityGrantMutation;

export interface ObjectiveEventEffect {
  type: string;
  title: string;
  description: string;
  impact_data: Record<string, unknown> | null;
  artifact_id: string | null;
}

export interface ObjectiveRulePlan {
  rule_id: string;
  capability_key: string | null;
  mediator_id: string | null;
  target_entity_id: string | null;
  diagnostics?: Record<string, unknown> | null;
  mutations: ObjectiveMutationEffect[];
  emitted_events: ObjectiveEventEffect[];
}

const toObjectiveInvocation = (invocation: InvocationRequest): WorldObjectiveRuleInvocation => {
  return {
    id: invocation.id,
    pack_id: invocation.pack_id,
    source_action_intent_id: invocation.source_action_intent_id,
    source_inference_id: invocation.source_inference_id,
    invocation_type: invocation.invocation_type,
    capability_key: invocation.capability_key,
    subject_entity_id: invocation.subject_entity_id,
    target_ref: invocation.target_ref,
    payload: invocation.payload,
    mediator_id: invocation.mediator_id,
    actor_ref: invocation.actor_ref,
    created_at: invocation.created_at.toString()
  };
};

const toObjectiveRuleDefinition = (rule: { id: string; when?: unknown; then?: unknown }): WorldObjectiveRuleDefinition => {
  return {
    id: rule.id,
    when: isRecord(rule.when) ? rule.when : {},
    then: isRecord(rule.then) ? rule.then : {}
  };
};

const toObjectiveWorldEntity = (packId: string, entity: { id: string; entity_kind: string }): WorldObjectiveWorldEntity => {
  const prefix = `${packId}:entity:`;
  return {
    id: entity.id.startsWith(prefix) ? entity.id.slice(prefix.length) : entity.id,
    entity_kind: entity.entity_kind
  };
};

export const buildSidecarObjectiveExecutionRequest = async (
  context: AppInfrastructure,
  input: {
    invocation: InvocationRequest;
    effectiveMediatorId: string | null;
    packStorageAdapter: PackStorageAdapter;
    filteredRules?: Array<{ id: string; when?: unknown; then?: unknown }> | null;
  },
  packRuntime?: { getPack(): { metadata: { id: string }; capabilities?: Array<{ key: string }> | undefined; rules?: { objective_enforcement?: Array<{ id: string; when?: unknown; then?: unknown }> | undefined } | undefined; variables?: Record<string, unknown> | undefined } | undefined }
): Promise<WorldRuleExecuteObjectiveRequest> => {
  const pack = packRuntime?.getPack();
  if (!pack || pack.metadata.id !== input.invocation.pack_id) {
    throw new ApiError(404, 'PACK_NOT_LOADED', 'World engine pack session is not loaded for objective rule execution', {
      pack_id: input.invocation.pack_id
    });
  }

  const worldEntities = await listPackWorldEntities(input.packStorageAdapter, input.invocation.pack_id);
  const rules = input.filteredRules ?? pack.rules?.objective_enforcement ?? [];
  return {
    protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
    pack_id: input.invocation.pack_id,
    invocation: toObjectiveInvocation(input.invocation),
    effective_mediator_id: input.effectiveMediatorId,
    objective_rules: rules.map(toObjectiveRuleDefinition),
    world_entities: worldEntities.map(entity => toObjectiveWorldEntity(input.invocation.pack_id, entity)),
    pack_variables: pack.variables ?? null
  };
};

export const toObjectiveRulePlanFromSidecarResult = (result: WorldRuleExecuteObjectiveResult): ObjectiveRulePlan => {
  return {
    rule_id: result.rule_id,
    capability_key: result.capability_key,
    mediator_id: result.mediator_id,
    target_entity_id: result.target_entity_id,
    diagnostics: result.diagnostics,
    mutations: result.mutations,
    emitted_events: result.emitted_events
  };
};
