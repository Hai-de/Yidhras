import { ApiError } from '../../../utils/api_error.js';

import type { AppContext } from '../../context.js';
import {
  DEFAULT_RELATIONSHIP_LOG_LIMIT,
  MAX_RELATIONSHIP_LOG_LIMIT,
  type ListAtmosphereNodesInput,
  type ListRelationshipAdjustmentLogsInput
} from './types.js';

export const listRelationalCircles = async (context: AppContext) => {
  return context.sim.prisma.circle.findMany({
    include: { members: true }
  });
};

export const listAtmosphereNodes = async (
  context: AppContext,
  input: ListAtmosphereNodesInput
) => {
  const ownerId = typeof input.owner_id === 'string' ? input.owner_id.trim() : '';
  const includeExpired = input.include_expired === true;
  const now = context.sim.clock.getTicks();

  return context.sim.prisma.atmosphereNode.findMany({
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

  const requestedLimit = typeof input.limit === 'number' && Number.isFinite(input.limit)
    ? Math.trunc(input.limit)
    : DEFAULT_RELATIONSHIP_LOG_LIMIT;
  const limit = Math.min(MAX_RELATIONSHIP_LOG_LIMIT, Math.max(1, requestedLimit));

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
