import { ApiError } from '../../../utils/api_error.js';
import { isRecord } from '../../../utils/type_guards.js';
import type { DbContext } from '../../../utils/db_context.js';

const EVENT_TYPE_ALLOWLIST = new Set(['history', 'interaction', 'system']);
const MAX_SNR = 1;
const MIN_SNR = 0;
const SNR_OPERATION_SET = 'set';

export const resolveTriggerEventActor = (actorRef: unknown): { kind: 'active' | 'system'; agent_id: string | null; identity_id: string } => {
  if (!isRecord(actorRef) || typeof actorRef['identity_id'] !== 'string' || actorRef['identity_id'].trim().length === 0) {
    throw new ApiError(500, 'ACTION_EVENT_ACTOR_INVALID', 'trigger_event requires a valid actor identity');
  }

  const identityId = actorRef['identity_id'].trim();
  if (identityId === 'system') {
    return { kind: 'system', agent_id: null, identity_id: identityId };
  }

  if (actorRef['role'] === 'active' && typeof actorRef['agent_id'] === 'string' && actorRef['agent_id'].trim().length > 0) {
    return {
      kind: 'active',
      agent_id: actorRef['agent_id'].trim(),
      identity_id: identityId
    };
  }

  throw new ApiError(500, 'ACTION_EVENT_ACTOR_INVALID', 'trigger_event currently requires an active actor or system identity');
};

export const resolveTriggerEventPayload = (payload: unknown): {
  event_type: 'history' | 'interaction' | 'system';
  title: string;
  description: string;
  impact_data: Record<string, unknown> | null;
  location_id?: string | null;
  visibility?: string | null;
} => {
  if (!isRecord(payload)) {
    throw new ApiError(500, 'ACTION_EVENT_INVALID', 'trigger_event payload must be an object');
  }

  if (typeof payload['event_type'] !== 'string' || !EVENT_TYPE_ALLOWLIST.has(payload['event_type'])) {
    throw new ApiError(500, 'EVENT_TYPE_UNSUPPORTED', 'trigger_event event_type is not supported');
  }

  if (typeof payload['title'] !== 'string' || payload['title'].trim().length === 0) {
    throw new ApiError(500, 'ACTION_EVENT_INVALID', 'trigger_event title is required');
  }

  if (typeof payload['description'] !== 'string' || payload['description'].trim().length === 0) {
    throw new ApiError(500, 'ACTION_EVENT_INVALID', 'trigger_event description is required');
  }

  if (isRecord(payload['impact_data']) && 'tick' in payload['impact_data']) {
    throw new ApiError(500, 'ACTION_EVENT_INVALID', 'trigger_event impact_data must not contain tick override');
  }

  if ('tick' in payload) {
    throw new ApiError(500, 'ACTION_EVENT_INVALID', 'trigger_event does not allow custom tick in payload');
  }

  if (payload['impact_data'] !== undefined && payload['impact_data'] !== null && !isRecord(payload['impact_data'])) {
    throw new ApiError(500, 'ACTION_EVENT_INVALID', 'trigger_event impact_data must be an object when provided');
  }

  const locationId = 'location_id' in payload && payload['location_id'] !== null ? payload['location_id'] : undefined;
  if (locationId !== undefined && typeof locationId !== 'string') {
    throw new ApiError(500, 'ACTION_EVENT_INVALID', 'trigger_event location_id must be a string when provided');
  }
  const visibility = 'visibility' in payload && payload['visibility'] !== null ? payload['visibility'] : undefined;
  if (visibility !== undefined && visibility !== 'public' && visibility !== 'private') {
    throw new ApiError(500, 'ACTION_EVENT_INVALID', "trigger_event visibility must be 'public' or 'private' when provided");
  }

  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    event_type: payload['event_type'] as 'history' | 'interaction' | 'system',
    title: payload['title'].trim(),
    description: payload['description'].trim(),
    impact_data: isRecord(payload['impact_data']) ? payload['impact_data'] : null,
    location_id: typeof locationId === 'string' ? locationId.trim() || null : null,
    visibility: visibility === 'public' || visibility === 'private' ? visibility : null
  };
};

export const resolveAdjustSnrActorAgentId = (actorRef: unknown): string => {
  if (!isRecord(actorRef) || actorRef['role'] !== 'active' || typeof actorRef['agent_id'] !== 'string' || actorRef['agent_id'].trim().length === 0) {
    throw new ApiError(500, 'ACTION_SNR_INVALID', 'adjust_snr requires an active actor agent');
  }

  return actorRef['agent_id'].trim();
};

export const resolveAdjustSnrTargetAgentId = (targetRef: unknown): string => {
  if (!isRecord(targetRef) || typeof targetRef['agent_id'] !== 'string' || targetRef['agent_id'].trim().length === 0) {
    throw new ApiError(500, 'ACTION_SNR_INVALID', 'adjust_snr target_ref.agent_id is required');
  }

  return targetRef['agent_id'].trim();
};

export const clampSnr = (value: number): number => {
  return Math.min(MAX_SNR, Math.max(MIN_SNR, value));
};

export const resolveAdjustSnrPayload = (payload: unknown): {
  operation: 'set';
  target_snr: number;
  reason: string | null;
} => {
  if (!isRecord(payload)) {
    throw new ApiError(500, 'ACTION_SNR_INVALID', 'adjust_snr payload must be an object');
  }

  if (payload['operation'] !== SNR_OPERATION_SET) {
    throw new ApiError(500, 'ACTION_SNR_INVALID', 'adjust_snr currently only supports operation=set');
  }

  if (typeof payload['target_snr'] !== 'number' || !Number.isFinite(payload['target_snr'])) {
    throw new ApiError(500, 'ACTION_SNR_INVALID', 'adjust_snr target_snr must be a finite number');
  }

  return {
    operation: 'set',
    target_snr: clampSnr(payload['target_snr']),
    reason: typeof payload['reason'] === 'string' ? payload['reason'] : null
  };
};

export const getAgentSnrTargetById = async (
  context: DbContext,
  agentId: string
): Promise<{ id: string; snr: number } | null> => {
  return context.prisma.agent.findUnique({
    where: {
      id: agentId
    },
    select: {
      id: true,
      snr: true
    }
  });
};

export const updateAgentSnr = async (
  context: DbContext,
  input: {
    agent_id: string;
    snr: number;
    updated_at: bigint;
  }
) => {
  return context.prisma.agent.update({
    where: {
      id: input.agent_id
    },
    data: {
      snr: input.snr,
      updated_at: input.updated_at
    }
  });
};

export const createSnrAdjustmentLog = async (
  context: DbContext,
  input: {
    action_intent_id: string;
    agent_id: string;
    operation: string;
    requested_value: number;
    baseline_value: number;
    resolved_value: number;
    reason: string | null;
    created_at: bigint;
    pack_id?: string | null;
  }
) => {
  return context.prisma.sNRAdjustmentLog.create({
    data: input
  });
};

export const createEventEvidence = async (
  context: DbContext,
  input: {
    title: string;
    description: string;
    tick: bigint;
    type: 'history' | 'interaction' | 'system';
    impact_data: string;
    source_action_intent_id: string;
    created_at: bigint;
    location_id?: string | null;
    visibility?: string | null;
    pack_id?: string | null;
  }
) => {
  return context.prisma.event.create({
    data: input
  });
};
