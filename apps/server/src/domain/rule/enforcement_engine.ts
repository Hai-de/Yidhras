import {
  WORLD_ENGINE_PROTOCOL_VERSION,
  type WorldRuleExecuteObjectiveResult,
  worldRuleExecuteObjectiveResultSchema
} from '@yidhras/contracts';

import type { AppContext } from '../../app/context.js';
import { listPackEntityStates, upsertPackEntityState } from '../../packs/storage/entity_state_repo.js';
import { ApiError } from '../../utils/api_error.js';
import { resolveAuthorityForSubject, resolveMediatorBindingsForPack } from '../authority/resolver.js';
import type { InvocationRequest } from '../invocation/invocation_dispatcher.js';
import { createObjectiveRuleExecutionRecord } from './execution_recorder.js';
import { buildSidecarObjectiveExecutionRequest, toObjectiveRulePlanFromSidecarResult } from './sidecar_objective_execution.js';

export interface InvocationEnforcementResult {
  rule_execution_id: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const buildPackEntityStateId = (packId: string, entityId: string, namespace: string): string => {
  return `${packId}:state:${entityId}:${namespace}`;
};

const resolveEffectiveCapabilityGrant = async (context: AppContext, invocation: InvocationRequest) => {
  if (!invocation.capability_key) {
    return null;
  }

  const authorityContext = await resolveAuthorityForSubject(context, {
    packId: invocation.pack_id,
    subjectEntityId: invocation.subject_entity_id
  });
  const matchedGrant =
    authorityContext.resolved_capabilities.find(capability => {
      if (capability.capability_key !== invocation.capability_key) {
        return false;
      }
      if (!invocation.mediator_id) {
        return true;
      }
      return capability.mediated_by_entity_id === invocation.mediator_id || capability.source_entity_id === invocation.mediator_id;
    }) ?? null;

  if (!matchedGrant) {
    throw new ApiError(403, 'INVOCATION_CAPABILITY_FORBIDDEN', 'Invocation capability is not granted to the subject', {
      capability_key: invocation.capability_key,
      subject_entity_id: invocation.subject_entity_id,
      mediator_id: invocation.mediator_id
    });
  }

  return matchedGrant;
};

const resolveEffectiveMediatorId = (
  invocation: InvocationRequest,
  capabilityGrant: Awaited<ReturnType<typeof resolveEffectiveCapabilityGrant>>
): string | null => {
  if (invocation.mediator_id) {
    return invocation.mediator_id;
  }
  if (capabilityGrant?.mediated_by_entity_id) {
    return capabilityGrant.mediated_by_entity_id;
  }
  return capabilityGrant?.source_entity_id ?? null;
};

const validateMediatorBinding = async (
  context: AppContext,
  packId: string,
  mediatorId: string | null
): Promise<void> => {
  if (!mediatorId) {
    return;
  }

  const bindings = await resolveMediatorBindingsForPack(context, { packId });
  const matchedBinding = bindings.find(binding => binding.mediator_id === mediatorId && binding.status === 'active') ?? null;
  if (!matchedBinding) {
    throw new ApiError(400, 'INVOCATION_MEDIATOR_INVALID', 'Invocation mediator is not bound in the pack runtime', {
      mediator_id: mediatorId,
      pack_id: packId
    });
  }
};

const hasEventBridge = (
  context: AppContext
): context is AppContext & {
  prisma: AppContext['prisma'] & {
    event: {
      create(args: {
        data: {
          title: string;
          description: string;
          tick: bigint;
          type: string;
          impact_data: string | null;
          source_action_intent_id: string;
          created_at: bigint;
        };
      }): Promise<{ id: string }>;
    };
    $transaction: <T>(callback: (tx: AppContext['prisma']) => Promise<T>) => Promise<T>;
  };
} => {
  const prismaCandidate = context.prisma as unknown;
  return (
    isRecord(prismaCandidate) &&
    typeof prismaCandidate.$transaction === 'function' &&
    isRecord(prismaCandidate.event) &&
    typeof prismaCandidate.event.create === 'function'
  );
};

const applyMutationEffect = async (
  input: {
    packId: string;
    entityId: string;
    stateNamespace: string;
    statePatch: Record<string, unknown>;
    now: bigint;
  }
): Promise<void> => {
  const states = await listPackEntityStates(input.packId);
  const existing = states.find(
    state => state.entity_id === input.entityId && state.state_namespace === input.stateNamespace
  ) ?? null;
  const nextState = {
    ...(existing?.state_json ?? {}),
    ...input.statePatch
  };

  await upsertPackEntityState({
    id: buildPackEntityStateId(input.packId, input.entityId, input.stateNamespace),
    pack_id: input.packId,
    entity_id: input.entityId,
    state_namespace: input.stateNamespace,
    state_json: nextState,
    now: input.now
  });
};

const buildEventBridgeImpactData = (
  invocation: InvocationRequest,
  event: {
    impact_data: Record<string, unknown> | null;
    artifact_id: string | null;
  }
): Record<string, unknown> => {
  return {
    ...(event.impact_data ?? {}),
    pack_id: invocation.pack_id,
    invocation_id: invocation.id,
    subject_entity_id: invocation.subject_entity_id,
    mediator_id: invocation.mediator_id,
    artifact_id: event.artifact_id,
    source_action_intent_id: invocation.source_action_intent_id,
    source_inference_id: invocation.source_inference_id
  };
};

const emitObjectiveEvents = async (
  context: AppContext,
  input: {
    invocation: InvocationRequest;
    events: Array<{
      type: string;
      title: string;
      description: string;
      impact_data: Record<string, unknown> | null;
      artifact_id: string | null;
    }>;
    now: bigint;
  }
): Promise<unknown[]> => {
  if (input.events.length === 0) {
    return [];
  }
  if (!hasEventBridge(context)) {
    return input.events.map(event => {
      const bridgeImpactData = buildEventBridgeImpactData(input.invocation, event);
      return {
        kind: 'event_skipped',
        type: event.type,
        title: event.title,
        description: event.description,
        impact_data: bridgeImpactData,
        artifact_id: event.artifact_id
      };
    });
  }

  const emittedEvents: unknown[] = [];
  for (const event of input.events) {
    const bridgeImpactData = buildEventBridgeImpactData(input.invocation, event);
    const created = await context.prisma.$transaction(async tx => {
      return tx.event.create({
        data: {
          title: event.title,
          description: event.description,
          tick: input.now,
          type: event.type,
          impact_data: JSON.stringify(bridgeImpactData),
          source_action_intent_id: input.invocation.source_action_intent_id,
          created_at: input.now
        }
      });
    });
    emittedEvents.push({
      kind: 'event',
      event_id: created.id,
      type: event.type,
      title: event.title,
      description: event.description,
      impact_data: bridgeImpactData,
      artifact_id: event.artifact_id
    });
  }

  return emittedEvents;
};

export const enforceInvocationRequest = async (
  context: AppContext,
  invocation: InvocationRequest
): Promise<InvocationEnforcementResult> => {
  const now = invocation.created_at;

  const normalizeObjectiveRuleSidecarResult = (value: unknown): WorldRuleExecuteObjectiveResult => {
    return worldRuleExecuteObjectiveResultSchema.parse({
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      ...(isRecord(value) ? value : {})
    });
  };

  const resolvePlan = async (mediatorId: string | null) => {
    if (!context.worldEngine) {
      throw new ApiError(503, 'WORLD_ENGINE_NOT_READY', 'World engine is not available');
    }
    const sidecarRequest = await buildSidecarObjectiveExecutionRequest(context, {
      invocation,
      effectiveMediatorId: mediatorId
    });
    const sidecarResult = normalizeObjectiveRuleSidecarResult(
      await context.worldEngine.executeObjectiveRule(sidecarRequest)
    );
    return toObjectiveRulePlanFromSidecarResult(sidecarResult);
  };

  try {
    const capabilityGrant = await resolveEffectiveCapabilityGrant(context, invocation);
    const mediatorId = resolveEffectiveMediatorId(invocation, capabilityGrant);
    await validateMediatorBinding(context, invocation.pack_id, mediatorId);

    const plan = await resolvePlan(mediatorId);

    for (const mutation of plan.mutations) {
      await applyMutationEffect({
        packId: invocation.pack_id,
        entityId: mutation.entity_id,
        stateNamespace: mutation.state_namespace,
        statePatch: mutation.state_patch,
        now
      });
    }

    const emittedEvents = await emitObjectiveEvents(context, {
      invocation,
      events: plan.emitted_events,
      now
    });

    const executionRecord = await createObjectiveRuleExecutionRecord({
      id: `${invocation.id}:execution`,
      pack_id: invocation.pack_id,
      rule_id: plan.rule_id,
      capability_key: plan.capability_key,
      mediator_id: plan.mediator_id,
      subject_entity_id: invocation.subject_entity_id,
      target_entity_id: plan.target_entity_id,
      execution_status: 'completed',
      payload_json: {
        source_action_intent_id: invocation.source_action_intent_id,
        source_inference_id: invocation.source_inference_id,
        invocation_type: invocation.invocation_type,
        sidecar_diagnostics: plan.diagnostics ?? null,
        mutation_count: plan.mutations.length
      },
      emitted_events_json: emittedEvents,
      now
    });

    return {
      rule_execution_id: executionRecord.id
    };
  } catch (error) {
    await createObjectiveRuleExecutionRecord({
      id: `${invocation.id}:execution`,
      pack_id: invocation.pack_id,
      rule_id: `failed:${invocation.invocation_type}`,
      capability_key: invocation.capability_key,
      mediator_id: invocation.mediator_id,
      subject_entity_id: invocation.subject_entity_id,
      target_entity_id:
        invocation.target_ref && typeof invocation.target_ref.entity_id === 'string'
          ? invocation.target_ref.entity_id
          : null,
      execution_status: 'failed',
      payload_json: {
        source_action_intent_id: invocation.source_action_intent_id,
        source_inference_id: invocation.source_inference_id,
        invocation_type: invocation.invocation_type,
        sidecar_diagnostics: error instanceof ApiError ? error.details ?? null : null,
        error_message: error instanceof Error ? error.message : String(error)
      },
      emitted_events_json: [],
      now
    });
    throw error;
  }
};
