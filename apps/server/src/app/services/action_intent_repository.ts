import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';

export interface ActionIntentRecord {
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

export interface ActionIntentDispatchReflection {
  id: string;
  source_inference_id: string;
  intent_type: string;
  actor_agent_id: string;
  target_ref: Record<string, unknown> | null;
  semantic_intent_kind: string | null;
  event_summaries: Array<{ id: string; type: string; title: string }>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

export const DEFAULT_ACTION_INTENT_LOCK_TICKS = 5n;

export const listDispatchableActionIntents = async (
  context: AppContext,
  limit = 10
): Promise<ActionIntentRecord[]> => {
  const now = context.sim.getCurrentTick();

  return context.prisma.actionIntent.findMany({
    where: {
      status: 'pending',
      OR: [{ scheduled_for_tick: null }, { scheduled_for_tick: { lte: now } }],
      AND: [
        {
          OR: [{ locked_by: null }, { lock_expires_at: null }, { lock_expires_at: { lte: now } }]
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
      OR: [{ scheduled_for_tick: null }, { scheduled_for_tick: { lte: now } }],
      AND: [
        {
          OR: [{ locked_by: null }, { lock_expires_at: null }, { lock_expires_at: { lte: now } }]
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

export const getActionIntentForDispatchReflection = async (
  context: AppContext,
  intentId: string
): Promise<ActionIntentDispatchReflection | null> => {
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
