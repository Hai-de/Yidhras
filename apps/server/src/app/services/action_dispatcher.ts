import { dispatchInvocationFromActionIntent } from '../../domain/invocation/invocation_dispatcher.js';
import { IdentityService } from '../../identity/service.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import { type ActionIntentRecord,assertActionIntentLockOwnership } from './action_intent_repository.js';
import {
  createEventEvidence,
  createSnrAdjustmentLog,
  getAgentSnrTargetById,
  resolveAdjustSnrActorAgentId,
  resolveAdjustSnrPayload,
  resolveAdjustSnrTargetAgentId,
  resolveTriggerEventActor,
  resolveTriggerEventPayload,
  updateAgentSnr
} from './agent_signal_repository.js';
import { buildMutationResolvedResult } from './mutation_resolved.js';
import {
  createRelationship,
  getRelationshipByCompositeKey,
  resolveActiveAgentIdFromActorRef,
  resolveAdjustRelationshipPayload,
  resolveRelationshipTargetAgentId,
  updateRelationshipWeight,
  writeRelationshipAdjustmentLog
} from './relationship_mutation_repository.js';
import { createSocialPost } from './social.js';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const resolveIdentityContext = async (context: AppContext, actorRef: unknown) => {
  if (!isRecord(actorRef) || typeof actorRef.identity_id !== 'string') {
    throw new ApiError(500, 'ACTION_DISPATCH_FAIL', 'Action intent actor_ref is invalid');
  }

  const identityService = new IdentityService(context.prisma);
  const identity = await identityService.fetchIdentity(actorRef.identity_id);
  if (!identity) {
    throw new ApiError(500, 'ACTION_DISPATCH_FAIL', 'Action intent identity could not be resolved', {
      identity_id: actorRef.identity_id
    });
  }

  return identity;
};

const resolvePostMessagePayload = (payload: unknown): string => {
  if (!isRecord(payload) || typeof payload.content !== 'string' || payload.content.trim().length === 0) {
    throw new ApiError(500, 'ACTION_DISPATCH_FAIL', 'post_message payload.content is required');
  }

  return payload.content.trim();
};

const resolveTransmissionPolicy = (
  policy: string
): 'reliable' | 'best_effort' | 'fragile' | 'blocked' => {
  if (policy === 'best_effort' || policy === 'fragile' || policy === 'blocked') {
    return policy;
  }

  return 'reliable';
};

const resolveDropDecision = (
  intent: ActionIntentRecord
): { dropped: boolean; reason: string | null } => {
  const policy = resolveTransmissionPolicy(intent.transmission_policy);

  if (policy === 'blocked') {
    return {
      dropped: true,
      reason: intent.drop_reason ?? 'policy_blocked'
    };
  }

  const chance = Number.isFinite(intent.transmission_drop_chance)
    ? Math.min(1, Math.max(0, intent.transmission_drop_chance))
    : 0;

  if (chance <= 0) {
    return {
      dropped: false,
      reason: null
    };
  }

  if (chance >= 1) {
    return {
      dropped: true,
      reason: intent.drop_reason ?? 'probabilistic_drop'
    };
  }

  return {
    dropped: Math.random() < chance,
    reason: intent.drop_reason ?? 'probabilistic_drop'
  };
};

const dispatchTriggerEventIntent = async (context: AppContext, intent: ActionIntentRecord): Promise<void> => {
  const actor = resolveTriggerEventActor(intent.actor_ref);
  const payload = resolveTriggerEventPayload(intent.payload);
  const now = context.sim.getCurrentTick();

  const activePack = context.sim.getActivePack();
  const impactData = {
    ...(payload.impact_data ?? {}),
    pack_id: activePack?.metadata.id ?? null,
    source_action_intent_id: intent.id,
    actor_identity_id: actor.identity_id,
    actor_agent_id: actor.agent_id,
    actor_kind: actor.kind
  };

  await createEventEvidence(context, {
    title: payload.title,
    description: payload.description,
    tick: now,
    type: payload.event_type,
    impact_data: JSON.stringify(impactData),
    source_action_intent_id: intent.id,
    created_at: now
  });
};

const dispatchAdjustSnrIntent = async (context: AppContext, intent: ActionIntentRecord): Promise<void> => {
  resolveAdjustSnrActorAgentId(intent.actor_ref);
  const targetAgentId = resolveAdjustSnrTargetAgentId(intent.target_ref);
  const payload = resolveAdjustSnrPayload(intent.payload);
  const now = context.sim.getCurrentTick();

  const targetAgent = await getAgentSnrTargetById(context, targetAgentId);
  if (!targetAgent) {
    throw new ApiError(500, 'SNR_TARGET_NOT_FOUND', 'adjust_snr target agent does not exist', {
      target_agent_id: targetAgentId
    });
  }

  const resolvedResult = buildMutationResolvedResult({
    action_intent_id: intent.id,
    operation: payload.operation,
    reason: payload.reason,
    target: { agent_id: targetAgentId },
    requested: { value: payload.target_snr },
    baseline: { value: targetAgent.snr },
    absolute: { value: payload.target_snr }
  });

  await updateAgentSnr(context, {
    agent_id: targetAgentId,
    snr: payload.target_snr,
    updated_at: now
  });

  await createSnrAdjustmentLog(context, {
    action_intent_id: intent.id,
    agent_id: targetAgentId,
    operation: resolvedResult.intent.operation,
    requested_value: resolvedResult.intent.requested.value as number,
    baseline_value: resolvedResult.baseline.value as number,
    resolved_value: resolvedResult.result.absolute.value as number,
    reason: payload.reason,
    created_at: now
  });
};

const dispatchAdjustRelationshipIntent = async (context: AppContext, intent: ActionIntentRecord): Promise<void> => {
  const actorAgentId = resolveActiveAgentIdFromActorRef(intent.actor_ref);
  const targetAgentId = await resolveRelationshipTargetAgentId(context, intent.target_ref, actorAgentId);
  const payload = resolveAdjustRelationshipPayload(intent.payload);
  const now = context.sim.getCurrentTick();

  const existing = await getRelationshipByCompositeKey(context, {
    from_id: actorAgentId,
    to_id: targetAgentId,
    type: payload.relationship_type
  });

  const buildRelationshipResolvedResult = (input: {
    relationship_id: string;
    baseline_weight: number | null;
  }) => buildMutationResolvedResult({
    action_intent_id: intent.id,
    operation: payload.operation,
    reason: payload.reason,
    target: { relationship_id: input.relationship_id, from_id: actorAgentId, to_id: targetAgentId, type: payload.relationship_type },
    requested: { weight: payload.target_weight },
    baseline: { weight: input.baseline_weight },
    absolute: { weight: payload.target_weight }
  });

  if (!existing) {
    if (!payload.create_if_missing) {
      throw new ApiError(500, 'RELATIONSHIP_NOT_FOUND', 'relationship edge does not exist and create_if_missing is false', {
        from_id: actorAgentId,
        to_id: targetAgentId,
        type: payload.relationship_type
      });
    }

    const created = await createRelationship(context, {
      from_id: actorAgentId,
      to_id: targetAgentId,
      type: payload.relationship_type,
      weight: payload.target_weight,
      created_at: now,
      updated_at: now
    });

    const resolvedResult = buildRelationshipResolvedResult({ relationship_id: created.id, baseline_weight: null });

    await writeRelationshipAdjustmentLog(context, {
      action_intent_id: intent.id,
      relationship_id: created.id,
      from_id: actorAgentId,
      to_id: targetAgentId,
      type: payload.relationship_type,
      operation: resolvedResult.intent.operation as 'set',
      old_weight: resolvedResult.baseline.weight as number | null,
      new_weight: resolvedResult.result.absolute.weight as number,
      reason: payload.reason,
      created_at: now
    });
    return;
  }

  await updateRelationshipWeight(context, {
    from_id: actorAgentId,
    to_id: targetAgentId,
    type: payload.relationship_type,
    weight: payload.target_weight,
    updated_at: now
  });

  const resolvedResult = buildRelationshipResolvedResult({ relationship_id: existing.id, baseline_weight: existing.weight });

  await writeRelationshipAdjustmentLog(context, {
    action_intent_id: intent.id,
    relationship_id: existing.id,
    from_id: actorAgentId,
    to_id: targetAgentId,
    type: payload.relationship_type,
    operation: resolvedResult.intent.operation as 'set',
    old_weight: resolvedResult.baseline.weight as number | null,
    new_weight: resolvedResult.result.absolute.weight as number,
    reason: payload.reason,
    created_at: now
  });
};

export {
  assertActionIntentLockOwnership,
  claimActionIntent,
  DEFAULT_ACTION_INTENT_LOCK_TICKS,
  getActionIntentForDispatchReflection,
  listDispatchableActionIntents,
  markActionIntentCompleted,
  markActionIntentDispatching,
  markActionIntentDropped,
  markActionIntentFailed,
  releaseActionIntentLock
} from './action_intent_repository.js';

export const dispatchActionIntent = async (
  context: AppContext,
  intent: ActionIntentRecord
): Promise<{ outcome: 'completed' | 'dropped'; reason: string | null }> => {
  assertActionIntentLockOwnership(intent, intent.locked_by ?? '', context.sim.getCurrentTick());

  const invocationResult = await dispatchInvocationFromActionIntent(context, {
    id: intent.id,
    source_inference_id: intent.source_inference_id,
    intent_type: intent.intent_type,
    actor_ref: intent.actor_ref,
    target_ref: intent.target_ref,
    payload: intent.payload
  });
  if (invocationResult) {
    return { outcome: invocationResult.outcome, reason: invocationResult.reason };
  }

  if (intent.intent_type === 'trigger_event') {
    await dispatchTriggerEventIntent(context, intent);
    return {
      outcome: 'completed',
      reason: null
    };
  }

  if (intent.intent_type === 'adjust_snr') {
    await dispatchAdjustSnrIntent(context, intent);
    return {
      outcome: 'completed',
      reason: null
    };
  }

  if (intent.intent_type === 'adjust_relationship') {
    await dispatchAdjustRelationshipIntent(context, intent);
    return {
      outcome: 'completed',
      reason: null
    };
  }

  if (intent.intent_type !== 'post_message') {
    throw new ApiError(500, 'ACTION_DISPATCH_FAIL', 'Unsupported action intent type', {
      intent_id: intent.id,
      intent_type: intent.intent_type
    });
  }

  const dropDecision = resolveDropDecision(intent);
  if (dropDecision.dropped) {
    return {
      outcome: 'dropped',
      reason: dropDecision.reason
    };
  }

  const identity = await resolveIdentityContext(context, intent.actor_ref);
  const content = resolvePostMessagePayload(intent.payload);

  await createSocialPost(context, identity, content, {
    source_action_intent_id: intent.id
  });
  return {
    outcome: 'completed',
    reason: null
  };
};
