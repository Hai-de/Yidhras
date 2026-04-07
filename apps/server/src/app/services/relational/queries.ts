import { ApiError } from '../../../utils/api_error.js'
import type { AppContext } from '../../context.js';
import {
  DEFAULT_RELATIONSHIP_LOG_LIMIT,
  type ListAtmosphereNodesInput,
  type ListRelationshipAdjustmentLogsInput,
  MAX_RELATIONSHIP_LOG_LIMIT} from './types.js'

export const listRelationalCircles = async (context: AppContext) => {
  return context.prisma.circle.findMany({
    include: { members: true }
  });
};

export const listAtmosphereNodes = async (
  context: AppContext,
  input: ListAtmosphereNodesInput
) => {
  const ownerId = typeof input.owner_id === 'string' ? input.owner_id.trim() : '';
  const includeExpired = input.include_expired === true;
  const now = context.sim.getCurrentTick();

  return context.prisma.atmosphereNode.findMany({
    where: {
      ...(ownerId.length === 0 ? {} : { owner_id: ownerId }),
      ...(includeExpired
        ? {}
        : {
            OR: [{ expires_at: null }, { expires_at: { gt: now } }]
          })
    },
    orderBy: { created_at: 'desc' }
  });
};

const parseRelationshipLogLimit = (value: number | undefined): number => {
  if (value === undefined) {
    return DEFAULT_RELATIONSHIP_LOG_LIMIT;
  }

  if (!Number.isFinite(value) || Number.isNaN(value)) {
    throw new ApiError(400, 'RELATIONSHIP_LOG_QUERY_INVALID', 'limit must be a positive integer', {
      field: 'limit',
      value
    });
  }

  const normalized = Math.trunc(value);
  if (normalized < 1) {
    throw new ApiError(400, 'RELATIONSHIP_LOG_QUERY_INVALID', 'limit must be a positive integer', {
      field: 'limit',
      value
    });
  }

  return Math.min(MAX_RELATIONSHIP_LOG_LIMIT, normalized);
};

export const listRelationshipAdjustmentLogs = async (
  context: AppContext,
  input: ListRelationshipAdjustmentLogsInput
) => {
  const fromId = typeof input.from_id === 'string' ? input.from_id.trim() : '';
  const toId = typeof input.to_id === 'string' ? input.to_id.trim() : '';
  const relationshipType = typeof input.type === 'string' ? input.type.trim() : '';

  if (fromId.length === 0 || toId.length === 0 || relationshipType.length === 0) {
    throw new ApiError(400, 'RELATIONSHIP_LOG_QUERY_INVALID', 'from_id, to_id, and type are required');
  }

  const limit = parseRelationshipLogLimit(input.limit);

  return context.prisma.relationshipAdjustmentLog.findMany({
    where: {
      from_id: fromId,
      to_id: toId,
      type: relationshipType
    },
    orderBy: {
      created_at: 'desc'
    },
    take: limit
  });
};
