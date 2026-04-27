import {
  type WorldObjectiveExecutionDiagnostics,
  type WorldObjectiveRuleDefinition,
  type WorldObjectiveRuleInvocation,
  type WorldObjectiveWorldEntity,
  type WorldRuleExecuteObjectiveRequest,
  type WorldRuleExecuteObjectiveResult
} from '@yidhras/contracts';

import type { ActivePackSource } from '../../app/context.js';
import { listPackWorldEntities } from '../../packs/storage/entity_repo.js';
import { ApiError } from '../../utils/api_error.js';
import type { InvocationRequest } from '../invocation/invocation_dispatcher.js';
import type { ObjectiveRulePlan } from './objective_rule_resolver.js';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

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
  context: ActivePackSource,
  input: {
    invocation: InvocationRequest;
    effectiveMediatorId: string | null;
  }
): Promise<WorldRuleExecuteObjectiveRequest> => {
  const pack = context.activePack.getActivePack();
  if (!pack || pack.metadata.id !== input.invocation.pack_id) {
    throw new ApiError(404, 'PACK_NOT_LOADED', 'World engine pack session is not loaded for objective rule execution', {
      pack_id: input.invocation.pack_id
    });
  }

  const worldEntities = await listPackWorldEntities(input.invocation.pack_id);
  return {
    protocol_version: 'world_engine/v1alpha1',
    pack_id: input.invocation.pack_id,
    invocation: toObjectiveInvocation(input.invocation),
    effective_mediator_id: input.effectiveMediatorId,
    objective_rules: (pack.rules?.objective_enforcement ?? []).map(toObjectiveRuleDefinition),
    world_entities: worldEntities.map(entity => toObjectiveWorldEntity(input.invocation.pack_id, entity))
  };
};

export const toObjectiveRulePlanFromSidecarResult = (result: WorldRuleExecuteObjectiveResult): ObjectiveRulePlan => {
  return {
    rule_id: result.rule_id,
    capability_key: result.capability_key,
    mediator_id: result.mediator_id,
    target_entity_id: result.target_entity_id,
    diagnostics: result.diagnostics as WorldObjectiveExecutionDiagnostics,
    mutations: result.mutations,
    emitted_events: result.emitted_events
  };
};
