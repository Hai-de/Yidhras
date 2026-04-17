import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';

export interface RelationshipAdjustmentLogInput {
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
}

export interface RelationshipTargetAgentRecord {
  id: string;
}

export interface RelationshipRecord {
  id: string;
  from_id: string;
  to_id: string;
  type: string;
  weight: number;
  created_at: bigint;
  updated_at: bigint;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

export const RELATIONSHIP_TYPE_ALLOWLIST = new Set(['friend', 'enemy', 'command', 'transfer']);
const MIN_RELATIONSHIP_WEIGHT = 0;
const MAX_RELATIONSHIP_WEIGHT = 1;
export const RELATIONSHIP_OPERATION_SET = 'set';

export const resolveActiveAgentIdFromActorRef = (actorRef: unknown): string => {
  if (!isRecord(actorRef) || actorRef.role !== 'active' || typeof actorRef.agent_id !== 'string' || actorRef.agent_id.trim().length === 0) {
    throw new ApiError(500, 'ACTION_RELATIONSHIP_INVALID', 'adjust_relationship requires an active actor agent');
  }

  return actorRef.agent_id.trim();
};

export const resolveRelationshipTargetAgentId = async (
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
    },
    select: {
      id: true
    }
  });
  if (!targetAgent) {
    throw new ApiError(500, 'ACTION_RELATIONSHIP_INVALID', 'adjust_relationship target agent does not exist', {
      target_agent_id: targetAgentId
    });
  }

  return targetAgent.id;
};

export const clampRelationshipWeight = (value: number): number => {
  return Math.min(MAX_RELATIONSHIP_WEIGHT, Math.max(MIN_RELATIONSHIP_WEIGHT, value));
};

export const resolveAdjustRelationshipPayload = (payload: unknown): {
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

export const getRelationshipByCompositeKey = async (
  context: AppContext,
  input: {
    from_id: string;
    to_id: string;
    type: string;
  }
): Promise<RelationshipRecord | null> => {
  return context.prisma.relationship.findUnique({
    where: {
      from_id_to_id_type: {
        from_id: input.from_id,
        to_id: input.to_id,
        type: input.type
      }
    }
  });
};

export const createRelationship = async (
  context: AppContext,
  input: {
    from_id: string;
    to_id: string;
    type: string;
    weight: number;
    created_at: bigint;
    updated_at: bigint;
  }
): Promise<RelationshipRecord> => {
  return context.prisma.relationship.create({
    data: input
  });
};

export const updateRelationshipWeight = async (
  context: AppContext,
  input: {
    from_id: string;
    to_id: string;
    type: string;
    weight: number;
    updated_at: bigint;
  }
): Promise<RelationshipRecord> => {
  return context.prisma.relationship.update({
    where: {
      from_id_to_id_type: {
        from_id: input.from_id,
        to_id: input.to_id,
        type: input.type
      }
    },
    data: {
      weight: input.weight,
      updated_at: input.updated_at
    }
  });
};

export const writeRelationshipAdjustmentLog = async (
  context: AppContext,
  input: RelationshipAdjustmentLogInput
) => {
  return context.prisma.relationshipAdjustmentLog.create({ data: input });
};
