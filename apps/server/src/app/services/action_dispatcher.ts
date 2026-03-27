import { IdentityPolicyService } from '../../identity/service.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
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

const resolveIdentityContext = async (context: AppContext, actorRef: unknown) => {
  if (!isRecord(actorRef) || typeof actorRef.identity_id !== 'string') {
    throw new ApiError(500, 'ACTION_DISPATCH_FAIL', 'Action intent actor_ref is invalid');
  }

  const identityService = new IdentityPolicyService(context.prisma);
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

export const listDispatchableActionIntents = async (
  context: AppContext,
  limit = 10
): Promise<ActionIntentRecord[]> => {
  const now = context.sim.clock.getTicks();

  return context.prisma.actionIntent.findMany({
    where: {
      status: 'pending',
      OR: [
        { scheduled_for_tick: null },
        { scheduled_for_tick: { lte: now } }
      ]
    },
    orderBy: {
      created_at: 'asc'
    },
    take: limit
  });
};

export const markActionIntentDispatching = async (
  context: AppContext,
  intentId: string
): Promise<ActionIntentRecord> => {
  const now = context.sim.clock.getTicks();

  return context.prisma.actionIntent.update({
    where: {
      id: intentId
    },
    data: {
      status: 'dispatching',
      dispatch_started_at: now,
      updated_at: now
    }
  });
};

export const markActionIntentCompleted = async (
  context: AppContext,
  intentId: string
): Promise<ActionIntentRecord> => {
  const now = context.sim.clock.getTicks();

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
  const now = context.sim.clock.getTicks();

  return context.prisma.actionIntent.update({
    where: {
      id: intentId
    },
    data: {
      status: 'failed',
      dispatch_error_code: code,
      dispatch_error_message: reason,
      updated_at: now
    }
  });
};

export const markActionIntentDropped = async (
  context: AppContext,
  intentId: string,
  reason: string | null
): Promise<ActionIntentRecord> => {
  const now = context.sim.clock.getTicks();

  return context.prisma.actionIntent.update({
    where: {
      id: intentId
    },
    data: {
      status: 'dropped',
      drop_reason: reason,
      dispatch_error_code: null,
      dispatch_error_message: null,
      updated_at: now
    }
  });
};

export const dispatchActionIntent = async (
  context: AppContext,
  intent: ActionIntentRecord
): Promise<{ outcome: 'completed' | 'dropped'; reason: string | null }> => {
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

  await createSocialPost(context, identity, content);
  return {
    outcome: 'completed',
    reason: null
  };
};
