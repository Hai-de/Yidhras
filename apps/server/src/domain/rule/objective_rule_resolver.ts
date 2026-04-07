import type { AppContext } from '../../app/context.js';
import { listPackWorldEntities } from '../../packs/storage/entity_repo.js';
import { ApiError } from '../../utils/api_error.js';
import type { ResolvedCapabilityItem } from '../authority/resolver.js';
import type { InvocationRequest } from '../invocation/invocation_dispatcher.js';

export interface ObjectiveMutationEffect {
  entity_id: string;
  state_namespace: string;
  state_patch: Record<string, unknown>;
}

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
  bridge_mode: 'objective_rule';
  mutations: ObjectiveMutationEffect[];
  emitted_events: ObjectiveEventEffect[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const extractEntityIdFromWorldEntityRecordId = (packId: string, recordId: string): string => {
  const prefix = `${packId}:entity:`;
  return recordId.startsWith(prefix) ? recordId.slice(prefix.length) : recordId;
};

const resolveTargetEntityId = (invocation: InvocationRequest): string | null => {
  if (typeof invocation.payload.target_entity_id === 'string' && invocation.payload.target_entity_id.trim().length > 0) {
    return invocation.payload.target_entity_id.trim();
  }
  if (invocation.target_ref && typeof invocation.target_ref.entity_id === 'string' && invocation.target_ref.entity_id.trim().length > 0) {
    return invocation.target_ref.entity_id.trim();
  }
  if (invocation.target_ref && typeof invocation.target_ref.agent_id === 'string' && invocation.target_ref.agent_id.trim().length > 0) {
    return invocation.target_ref.agent_id.trim();
  }
  return null;
};

const resolveArtifactId = (invocation: InvocationRequest): string | null => {
  if (typeof invocation.payload.artifact_id === 'string' && invocation.payload.artifact_id.trim().length > 0) {
    return invocation.payload.artifact_id.trim();
  }
  return null;
};

const resolveTargetKindCondition = (when: Record<string, unknown>): string | null => {
  if (typeof when['target.kind'] === 'string' && when['target.kind'].trim().length > 0) {
    return when['target.kind'].trim();
  }
  const target = when.target;
  if (isRecord(target) && typeof target.kind === 'string' && target.kind.trim().length > 0) {
    return target.kind.trim();
  }
  return null;
};

const resolveTargetEntityKind = async (packId: string, targetEntityId: string | null): Promise<string | null> => {
  if (!targetEntityId) {
    return null;
  }

  const entities = await listPackWorldEntities(packId);
  const target = entities.find(entity => extractEntityIdFromWorldEntityRecordId(packId, entity.id) === targetEntityId) ?? null;
  return target?.entity_kind ?? null;
};

const resolveTemplatePathValue = (context: Record<string, unknown>, path: string): unknown => {
  const parts = path.split('.');
  let current: unknown = context;
  for (const part of parts) {
    if (!isRecord(current) || !(part in current)) {
      return '';
    }
    current = current[part];
  }
  return current ?? '';
};

const renderStringTemplate = (template: string, context: Record<string, unknown>): string => {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_full, path) => {
    const value = resolveTemplatePathValue(context, String(path));
    if (value === null || value === undefined) {
      return '';
    }
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
  });
};

const renderObjectiveEffectValue = (value: unknown, invocation: InvocationRequest): unknown => {
  if (typeof value === 'string') {
    switch (value.trim()) {
      case '{{subject_entity_id}}':
        return invocation.subject_entity_id;
      case '{{target_entity_id}}':
        return resolveTargetEntityId(invocation);
      case '{{artifact_id}}':
        return resolveArtifactId(invocation);
      case '{{mediator_id}}':
        return invocation.mediator_id;
      default:
        return value;
    }
  }

  if (Array.isArray(value)) {
    return value.map(item => renderObjectiveEffectValue(item, invocation));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderObjectiveEffectValue(item, invocation)])
    );
  }

  return value;
};

const renderObjectiveStatePatch = (
  statePatch: Record<string, unknown>,
  invocation: InvocationRequest
): Record<string, unknown> => {
  return renderObjectiveEffectValue(statePatch, invocation) as Record<string, unknown>;
};

const buildObjectiveEventTemplateContext = (invocation: InvocationRequest, artifactId: string | null): Record<string, unknown> => {
  const targetEntityId = resolveTargetEntityId(invocation);
  return {
    subject_entity_id: invocation.subject_entity_id,
    target_entity_id: targetEntityId,
    artifact_id: artifactId,
    mediator_id: invocation.mediator_id,
    actor: {
      id: invocation.subject_entity_id,
      name: invocation.subject_entity_id
    },
    target: {
      id: targetEntityId
    },
    artifact: {
      id: artifactId,
      label: artifactId ?? '',
      state: {
        location: artifactId ? '{{artifact_location_before_mutation}}' : ''
      }
    },
    mediator: {
      id: invocation.mediator_id
    }
  };
};

const normalizeImpactData = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value)) {
    return null;
  }
  return value;
};

const resolveObjectiveEventEffects = (
  then: Record<string, unknown>,
  invocation: InvocationRequest
): ObjectiveEventEffect[] => {
  if (!Array.isArray(then.emit_events)) {
    return [];
  }

  return then.emit_events.flatMap(effect => {
    if (!isRecord(effect)) {
      return [];
    }

    const artifactIdCandidate = renderObjectiveEffectValue(effect.artifact_id, invocation);
    const artifactId = typeof artifactIdCandidate === 'string' ? artifactIdCandidate : resolveArtifactId(invocation);
    const templateContext = buildObjectiveEventTemplateContext(invocation, artifactId);

    const typeValue = renderObjectiveEffectValue(effect.type, invocation);
    const titleValue = renderObjectiveEffectValue(effect.title, invocation);
    const descriptionValue = renderObjectiveEffectValue(effect.description, invocation);
    const impactDataValue = renderObjectiveEffectValue(effect.impact_data, invocation);

    const type = typeof typeValue === 'string' && typeValue.trim().length > 0 ? typeValue.trim() : 'history';
    const titleSource = typeof titleValue === 'string' ? titleValue : '';
    const descriptionSource = typeof descriptionValue === 'string' ? descriptionValue : '';
    const title = renderStringTemplate(titleSource, templateContext).trim();
    const description = renderStringTemplate(descriptionSource, templateContext).trim();

    if (title.length === 0 || description.length === 0) {
      return [];
    }

    return [
      {
        type,
        title,
        description,
        impact_data: normalizeImpactData(impactDataValue),
        artifact_id: artifactId ?? null
      }
    ];
  });
};

const resolveObjectiveRulePlanFromRules = async (
  context: AppContext,
  invocation: InvocationRequest,
  effectiveMediatorId: string | null
): Promise<ObjectiveRulePlan | null> => {
  const pack = context.sim.getActivePack();
  if (!pack) {
    return null;
  }

  const targetEntityId = resolveTargetEntityId(invocation);
  const targetStateEntityId = targetEntityId ?? resolveArtifactId(invocation);
  const targetEntityKind = await resolveTargetEntityKind(invocation.pack_id, targetEntityId);
  const objectiveRules = pack.rules?.objective_enforcement ?? [];

  for (const rule of objectiveRules) {
    const when = isRecord(rule.when) ? rule.when : {};
    if (typeof when.capability === 'string' && invocation.capability_key !== when.capability) {
      continue;
    }
    if (typeof when.mediator === 'string' && effectiveMediatorId !== when.mediator) {
      continue;
    }
    if (typeof when.invocation_type === 'string' && invocation.invocation_type !== when.invocation_type) {
      continue;
    }

    const targetKindCondition = resolveTargetKindCondition(when);
    if (targetKindCondition && targetEntityKind !== targetKindCondition) {
      continue;
    }

    const then = isRecord(rule.then) ? rule.then : {};
    const mutate = isRecord(then.mutate) ? then.mutate : {};
    const mutations: ObjectiveMutationEffect[] = [];

    if (isRecord(mutate.subject_state) && invocation.subject_entity_id) {
      mutations.push({
        entity_id: invocation.subject_entity_id,
        state_namespace: 'core',
        state_patch: renderObjectiveStatePatch(mutate.subject_state, invocation)
      });
    }
    if (isRecord(mutate.target_state) && targetStateEntityId) {
      mutations.push({
        entity_id: targetStateEntityId,
        state_namespace: 'core',
        state_patch: renderObjectiveStatePatch(mutate.target_state, invocation)
      });
    }
    if (isRecord(mutate.world_state)) {
      mutations.push({
        entity_id: '__world__',
        state_namespace: 'world',
        state_patch: renderObjectiveStatePatch(mutate.world_state, invocation)
      });
    }

    const emitted_events = resolveObjectiveEventEffects(then, invocation);

    return {
      rule_id: rule.id,
      capability_key: invocation.capability_key,
      mediator_id: effectiveMediatorId,
      target_entity_id: targetEntityId,
      bridge_mode: 'objective_rule',
      mutations,
      emitted_events
    };
  }

  return null;
};

export const resolveObjectiveRulePlan = async (
  context: AppContext,
  input: {
    invocation: InvocationRequest;
    capabilityGrant: ResolvedCapabilityItem | null;
    mediatorId: string | null;
  }
): Promise<ObjectiveRulePlan> => {
  const pack = context.sim.getActivePack();
  if (!pack) {
    throw new ApiError(503, 'WORLD_PACK_NOT_READY', 'World pack not ready for objective rule resolution');
  }

  const planFromRules = await resolveObjectiveRulePlanFromRules(context, input.invocation, input.mediatorId);
  if (planFromRules) {
    return planFromRules;
  }

  throw new ApiError(500, 'OBJECTIVE_RULE_NOT_FOUND', 'No objective rule plan matched the invocation', {
    invocation_type: input.invocation.invocation_type,
    capability_key: input.invocation.capability_key,
    mediator_id: input.mediatorId,
    source_entity_id: input.capabilityGrant?.source_entity_id ?? null
  });
};
