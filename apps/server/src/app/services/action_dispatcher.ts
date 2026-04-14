import { dispatchInvocationFromActionIntent } from '../../domain/invocation/invocation_dispatcher.js';
import { IdentityService } from '../../identity/service.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import { buildMutationResolvedResult } from './mutation_resolved.js';
import { createSocialPost } from './social.js';

interface ActionIntentRecord {
  id: string;
  source_inference_id: string;
  intent_type: string;
  actor_ref: unknown;
  target_ref: unknown;
  payload: unknown;
  scheduled_after_ticks: bigint | null;
  scheduled_for_tick: bigint | null;
  status: string;
  locked_by: string | null;
  locked_at: bigint | null;
  lock_expires_at: bigint | null;
  dispatch_started_at: bigint | null;
  dispatched_at: bigint | null;
  transmission_delay_ticks: bigint | null;
  transmission_policy: string;
  transmission_drop_chance: number;
  drop_reason: string | null;
  dispatch_error_code: string | null;
  dispatch_error_message: string | null;
  created_at: bigint;
  updated_at: bigint;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

export const DEFAULT_ACTION_INTENT_LOCK_TICKS = 5n;

const RELATIONSHIP_TYPE_ALLOWLIST = new Set(['friend', 'enemy', 'command', 'transfer']);
const EVENT_TYPE_ALLOWLIST = new Set(['history', 'interaction', 'system']);
const MIN_RELATIONSHIP_WEIGHT = 0;
const MAX_SNR = 1;
const MIN_SNR = 0;
const SNR_OPERATION_SET = 'set';

const MAX_RELATIONSHIP_WEIGHT = 1;
const RELATIONSHIP_OPERATION_SET = 'set';

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

const resolveTriggerEventActor = (actorRef: unknown): { kind: 'active' | 'system'; agent_id: string | null; identity_id: string } => {
  if (!isRecord(actorRef) || typeof actorRef.identity_id !== 'string' || actorRef.identity_id.trim().length === 0) {
    throw new ApiError(500, 'ACTION_EVENT_ACTOR_INVALID', 'trigger_event requires a valid actor identity');
  }

  const identityId = actorRef.identity_id.trim();
  if (identityId === 'system') {
    return { kind: 'system', agent_id: null, identity_id: identityId };
  }

  if (actorRef.role === 'active' && typeof actorRef.agent_id === 'string' && actorRef.agent_id.trim().length > 0) {
    return {
      kind: 'active',
      agent_id: actorRef.agent_id.trim(),
      identity_id: identityId
    };
  }

  throw new ApiError(500, 'ACTION_EVENT_ACTOR_INVALID', 'trigger_event currently requires an active actor or system identity');
};

const resolveTriggerEventPayload = (payload: unknown): {
  event_type: 'history' | 'interaction' | 'system';
  title: string;
  description: string;
  impact_data: Record<string, unknown> | null;
} => {
  if (!isRecord(payload)) {
    throw new ApiError(500, 'ACTION_EVENT_INVALID', 'trigger_event payload must be an object');
  }

  if (typeof payload.event_type !== 'string' || !EVENT_TYPE_ALLOWLIST.has(payload.event_type)) {
    throw new ApiError(500, 'EVENT_TYPE_UNSUPPORTED', 'trigger_event event_type is not supported');
  }

  if (typeof payload.title !== 'string' || payload.title.trim().length === 0) {
    throw new ApiError(500, 'ACTION_EVENT_INVALID', 'trigger_event title is required');
  }

  if (typeof payload.description !== 'string' || payload.description.trim().length === 0) {
    throw new ApiError(500, 'ACTION_EVENT_INVALID', 'trigger_event description is required');
  }

  if (isRecord(payload.impact_data) && 'tick' in payload.impact_data) {
    throw new ApiError(500, 'ACTION_EVENT_INVALID', 'trigger_event impact_data must not contain tick override');
  }

  if ('tick' in payload) {
    throw new ApiError(500, 'ACTION_EVENT_INVALID', 'trigger_event does not allow custom tick in payload');
  }

  if (payload.impact_data !== undefined && payload.impact_data !== null && !isRecord(payload.impact_data)) {
    throw new ApiError(500, 'ACTION_EVENT_INVALID', 'trigger_event impact_data must be an object when provided');
  }

  return {
    event_type: payload.event_type as 'history' | 'interaction' | 'system',
    title: payload.title.trim(),
    description: payload.description.trim(),
    impact_data: isRecord(payload.impact_data) ? payload.impact_data : null
  };
};

const resolveActiveAgentIdFromActorRef = (actorRef: unknown): string => {
  if (!isRecord(actorRef) || actorRef.role !== 'active' || typeof actorRef.agent_id !== 'string' || actorRef.agent_id.trim().length === 0) {
    throw new ApiError(500, 'ACTION_RELATIONSHIP_INVALID', 'adjust_relationship requires an active actor agent');
  }

  return actorRef.agent_id.trim();
};

const resolveRelationshipTargetAgentId = async (
  context: AppContext,
  targetRef: unknown,
  actorAgentId: string
): Promise<string> => {
  if (!isRecord(targetRef) || typeof targetRef.agent_id !== 'string' || targetRef.agent_id.trim().length === 0) {
    throw new ApiError(500, 'ACTION_RELATIONSHIP_INVALID', 'adjust_relationship target_ref.agent_id is required');
  }

  const targetAgentId = targetRef.agent_id.trim();
  if (targetAgentId === actorAgentId) {
    throw new ApiError(500, 'ACTION_RELATIONSHIP_INVALID', 'adjust_relationship target cannot equal actor');
  }

  const targetAgent = await context.prisma.agent.findUnique({
    where: {
      id: targetAgentId
    }
  });
  if (!targetAgent) {
    throw new ApiError(500, 'ACTION_RELATIONSHIP_INVALID', 'adjust_relationship target agent does not exist', {
      target_agent_id: targetAgentId
    });
  }

  return targetAgentId;
};

const clampRelationshipWeight = (value: number): number => {
  return Math.min(MAX_RELATIONSHIP_WEIGHT, Math.max(MIN_RELATIONSHIP_WEIGHT, value));
};

const resolveAdjustRelationshipPayload = (payload: unknown): {
  relationship_type: string;
  operation: 'set';
  target_weight: number;
  create_if_missing: boolean;
  reason: string | null;
} => {
  if (!isRecord(payload)) {
    throw new ApiError(500, 'ACTION_RELATIONSHIP_INVALID', 'adjust_relationship payload must be an object');
  }

  if (payload.operation !== RELATIONSHIP_OPERATION_SET) {
    throw new ApiError(500, 'ACTION_RELATIONSHIP_INVALID', 'adjust_relationship currently only supports operation=set');
  }

  if (typeof payload.relationship_type !== 'string' || !RELATIONSHIP_TYPE_ALLOWLIST.has(payload.relationship_type)) {
    throw new ApiError(500, 'RELATIONSHIP_TYPE_UNSUPPORTED', 'relationship_type is not supported');
  }

  if (typeof payload.target_weight !== 'number' || !Number.isFinite(payload.target_weight)) {
    throw new ApiError(500, 'RELATIONSHIP_WEIGHT_INVALID', 'target_weight must be a finite number');
  }

  return {
    relationship_type: payload.relationship_type,
    operation: 'set',
    target_weight: clampRelationshipWeight(payload.target_weight),
    create_if_missing: payload.create_if_missing === true,
    reason: typeof payload.reason === 'string' ? payload.reason : null
  };
};

const clampSnr = (value: number): number => {
  return Math.min(MAX_SNR, Math.max(MIN_SNR, value));
};

const resolveAdjustSnrActorAgentId = (actorRef: unknown): string => {
  if (!isRecord(actorRef) || actorRef.role !== 'active' || typeof actorRef.agent_id !== 'string' || actorRef.agent_id.trim().length === 0) {
    throw new ApiError(500, 'ACTION_SNR_INVALID', 'adjust_snr requires an active actor agent');
  }

  return actorRef.agent_id.trim();
};

const resolveAdjustSnrTargetAgentId = (targetRef: unknown): string => {
  if (!isRecord(targetRef) || typeof targetRef.agent_id !== 'string' || targetRef.agent_id.trim().length === 0) {
    throw new ApiError(500, 'ACTION_SNR_INVALID', 'adjust_snr target_ref.agent_id is required');
  }

  return targetRef.agent_id.trim();
};

const resolveAdjustSnrPayload = (payload: unknown): {
  operation: 'set';
  target_snr: number;
  reason: string | null;
} => {
  if (!isRecord(payload)) {
    throw new ApiError(500, 'ACTION_SNR_INVALID', 'adjust_snr payload must be an object');
  }

  if (payload.operation !== SNR_OPERATION_SET) {
    throw new ApiError(500, 'ACTION_SNR_INVALID', 'adjust_snr currently only supports operation=set');
  }

  if (typeof payload.target_snr !== 'number' || !Number.isFinite(payload.target_snr)) {
    throw new ApiError(500, 'ACTION_SNR_INVALID', 'adjust_snr target_snr must be a finite number');
  }

  return {
    operation: 'set',
    target_snr: clampSnr(payload.target_snr),
    reason: typeof payload.reason === 'string' ? payload.reason : null
  };
};

const writeRelationshipAdjustmentLog = async (context: AppContext, input: {
  action_intent_id: string;
  relationship_id: string;
  from_id: string;
  to_id: string;
  type: string;
  operation: 'set';
  old_weight: number | null;
  new_weight: number;
  reason: string | null;
  created_at: bigint;
}) => {
  return context.prisma.relationshipAdjustmentLog.create({ data: input });
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

  await context.prisma.event.create({
    data: {
      title: payload.title,
      description: payload.description,
      tick: now,
      type: payload.event_type,
      impact_data: JSON.stringify(impactData),
      source_action_intent_id: intent.id,
      created_at: now
    }
  });
};

const dispatchAdjustSnrIntent = async (context: AppContext, intent: ActionIntentRecord): Promise<void> => {
  resolveAdjustSnrActorAgentId(intent.actor_ref);
  const targetAgentId = resolveAdjustSnrTargetAgentId(intent.target_ref);
  const payload = resolveAdjustSnrPayload(intent.payload);
  const now = context.sim.getCurrentTick();

  await context.prisma.$transaction(async tx => {
    const targetAgent = await tx.agent.findUnique({
      where: {
        id: targetAgentId
      },
      select: {
        id: true,
        snr: true
      }
    });
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

    await tx.agent.update({
      where: {
        id: targetAgentId
      },
      data: {
        snr: payload.target_snr,
        updated_at: now
      }
    });

    await tx.sNRAdjustmentLog.create({
      data: {
        action_intent_id: intent.id,
        agent_id: targetAgentId,
        operation: resolvedResult.intent.operation,
        requested_value: resolvedResult.intent.requested.value as number,
        baseline_value: resolvedResult.baseline.value as number,
        resolved_value: resolvedResult.result.absolute.value as number,
        reason: payload.reason,
        created_at: now
      }
    });
  });
};

const dispatchAdjustRelationshipIntent = async (context: AppContext, intent: ActionIntentRecord): Promise<void> => {
  const actorAgentId = resolveActiveAgentIdFromActorRef(intent.actor_ref);
  const targetAgentId = await resolveRelationshipTargetAgentId(context, intent.target_ref, actorAgentId);
  const payload = resolveAdjustRelationshipPayload(intent.payload);
  const now = context.sim.getCurrentTick();

  const existing = await context.prisma.relationship.findUnique({
    where: {
      from_id_to_id_type: {
        from_id: actorAgentId,
        to_id: targetAgentId,
        type: payload.relationship_type
      }
    }
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

    const created = await context.prisma.relationship.create({
      data: {
        from_id: actorAgentId,
        to_id: targetAgentId,
        type: payload.relationship_type,
        weight: payload.target_weight,
        created_at: now,
        updated_at: now
      }
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

  await context.prisma.relationship.update({
    where: {
      from_id_to_id_type: {
        from_id: actorAgentId,
        to_id: targetAgentId,
        type: payload.relationship_type
      }
    },
    data: {
      weight: payload.target_weight,
      updated_at: now
    }
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

export const listDispatchableActionIntents = async (
  context: AppContext,
  limit = 10
): Promise<ActionIntentRecord[]> => {
  const now = context.sim.getCurrentTick();

  return context.prisma.actionIntent.findMany({
    where: {
      status: 'pending',
      OR: [
        { scheduled_for_tick: null },
        { scheduled_for_tick: { lte: now } }
      ],
      AND: [
        {
          OR: [
            { locked_by: null },
            { lock_expires_at: null },
            { lock_expires_at: { lte: now } }
          ]
        }
      ]
    },
    orderBy: {
      created_at: 'asc'
    },
    take: limit
  });
};

export const claimActionIntent = async (
  context: AppContext,
  input: {
    intent_id: string;
    worker_id: string;
    now?: bigint;
    lock_ticks?: bigint;
  }
): Promise<ActionIntentRecord | null> => {
  const now = input.now ?? context.sim.getCurrentTick();
  const lockTicks = input.lock_ticks ?? DEFAULT_ACTION_INTENT_LOCK_TICKS;
  const existing = await context.prisma.actionIntent.findUnique({
    where: {
      id: input.intent_id
    }
  });

  if (!existing || existing.status !== 'pending') {
    return null;
  }

  if (existing.scheduled_for_tick !== null && existing.scheduled_for_tick > now) {
    return null;
  }

  const claimable = existing.locked_by === null || existing.lock_expires_at === null || existing.lock_expires_at <= now;
  if (!claimable) {
    return null;
  }

  const claimResult = await context.prisma.actionIntent.updateMany({
    where: {
      id: existing.id,
      status: 'pending',
      OR: [
        { scheduled_for_tick: null },
        { scheduled_for_tick: { lte: now } }
      ],
      AND: [
        {
          OR: [
            { locked_by: null },
            { lock_expires_at: null },
            { lock_expires_at: { lte: now } }
          ]
        }
      ]
    },
    data: {
      status: 'dispatching',
      locked_by: input.worker_id,
      locked_at: now,
      lock_expires_at: now + lockTicks,
      dispatch_started_at: existing.dispatch_started_at ?? now,
      updated_at: now
    }
  });

  if (claimResult.count === 0) {
    return null;
  }

  return context.prisma.actionIntent.findUnique({
    where: {
      id: existing.id
    }
  });
};

export const releaseActionIntentLock = async (
  context: AppContext,
  input: {
    intent_id: string;
    worker_id?: string;
  }
): Promise<ActionIntentRecord | null> => {
  const existing = await context.prisma.actionIntent.findUnique({
    where: {
      id: input.intent_id
    }
  });

  if (!existing) {
    return null;
  }

  if (input.worker_id && existing.locked_by !== input.worker_id) {
    return existing;
  }

  return context.prisma.actionIntent.update({
    where: {
      id: existing.id
    },
    data: {
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      updated_at: context.sim.getCurrentTick()
    }
  });
};

export const assertActionIntentLockOwnership = (intent: ActionIntentRecord, workerId: string, now: bigint): void => {
  if (intent.status !== 'dispatching' || intent.locked_by !== workerId || intent.lock_expires_at === null || intent.lock_expires_at < now) {
    throw new ApiError(409, 'ACTION_INTENT_NOT_FOUND', 'Action intent lock ownership is invalid', {
      intent_id: intent.id,
      worker_id: workerId
    });
  }
};

export const markActionIntentDispatching = async (
  context: AppContext,
  intentId: string
): Promise<ActionIntentRecord> => {
  const now = context.sim.getCurrentTick();

  return context.prisma.actionIntent.update({
    where: {
      id: intentId
    },
    data: {
      status: 'dispatching',
      dispatch_started_at: now,
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      updated_at: now
    }
  });
};

export const markActionIntentCompleted = async (
  context: AppContext,
  intentId: string
): Promise<ActionIntentRecord> => {
  const now = context.sim.getCurrentTick();

  return context.prisma.actionIntent.update({
    where: {
      id: intentId
    },
    data: {
      status: 'completed',
      dispatched_at: now,
      drop_reason: null,
      dispatch_error_code: null,
      dispatch_error_message: null,
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      updated_at: now
    }
  });
};

export const markActionIntentFailed = async (
  context: AppContext,
  intentId: string,
  reason: string | null = null,
  code: string | null = 'ACTION_DISPATCH_FAIL'
): Promise<ActionIntentRecord> => {
  const now = context.sim.getCurrentTick();

  return context.prisma.actionIntent.update({
    where: {
      id: intentId
    },
    data: {
      status: 'failed',
      dispatch_error_code: code,
      dispatch_error_message: reason,
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      updated_at: now
    }
  });
};

export const markActionIntentDropped = async (
  context: AppContext,
  intentId: string,
  reason: string | null
): Promise<ActionIntentRecord> => {
  const now = context.sim.getCurrentTick();

  return context.prisma.actionIntent.update({
    where: {
      id: intentId
    },
    data: {
      status: 'dropped',
      drop_reason: reason,
      dispatch_error_code: null,
      dispatch_error_message: null,
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      updated_at: now
    }
  });
};

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

export const getActionIntentForDispatchReflection = async (
  context: AppContext,
  intentId: string
): Promise<{
  id: string;
  source_inference_id: string;
  intent_type: string;
  actor_agent_id: string;
  target_ref: Record<string, unknown> | null;
  semantic_intent_kind: string | null;
  event_summaries: Array<{ id: string; type: string; title: string }>;
} | null> => {
  const intent = await context.prisma.actionIntent.findUnique({
    where: {
      id: intentId
    }
  });
  if (!intent || !isRecord(intent.actor_ref)) {
    return null;
  }

  const actorAgentId = typeof intent.actor_ref.agent_id === 'string' && intent.actor_ref.agent_id.trim().length > 0
    ? intent.actor_ref.agent_id.trim()
    : null;
  if (!actorAgentId) {
    return null;
  }

  const trace = await context.prisma.inferenceTrace.findUnique({
    where: {
      id: intent.source_inference_id
    }
  });
  const decision = trace && isRecord(trace.decision) ? trace.decision : null;
  const events = await context.prisma.event.findMany({
    where: {
      source_action_intent_id: intentId
    },
    orderBy: {
      created_at: 'desc'
    },
    take: 5
  });

  return {
    id: intent.id,
    source_inference_id: intent.source_inference_id,
    intent_type: intent.intent_type,
    actor_agent_id: actorAgentId,
    target_ref: isRecord(intent.target_ref) ? intent.target_ref : null,
    semantic_intent_kind: decision && typeof decision.payload === 'object' && decision.payload !== null && !Array.isArray(decision.payload) && typeof (decision.payload as Record<string, unknown>).semantic_intent_kind === 'string'
      ? ((decision.payload as Record<string, unknown>).semantic_intent_kind as string)
      : null,
    event_summaries: events.map(event => ({ id: event.id, type: event.type, title: event.title }))
  };
};
