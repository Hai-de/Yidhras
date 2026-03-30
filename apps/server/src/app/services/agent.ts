import { PermissionContext } from '../../permission/types.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';

export interface ListSnrAdjustmentLogsInput {
  agent_id?: string;
  limit?: number;
}

const DEFAULT_SNR_LOG_LIMIT = 20;
const MAX_SNR_LOG_LIMIT = 100;

const buildPermissionContext = (agent: {
  id: string;
  circle_memberships: Array<{
    circle_id: string;
    circle: {
      level: number;
    };
  }>;
}): PermissionContext => {
  return {
    agent_id: agent.id,
    circles: new Set(agent.circle_memberships.map(membership => membership.circle_id)),
    global_level: Math.max(...agent.circle_memberships.map(membership => membership.circle.level), 0)
  };
};

export const getAgentContextSnapshot = async (context: AppContext, agentId: string) => {
  const agent = await context.sim.prisma.agent.findUnique({
    where: { id: agentId },
    include: { circle_memberships: { include: { circle: true } } }
  });

  if (!agent) {
    throw new ApiError(404, 'AGENT_NOT_FOUND', 'Agent not found', { agent_id: agentId });
  }

  const permission = buildPermissionContext(agent);
  const pack = context.sim.getActivePack();
  const resolvedVariables = context.sim.resolver.resolve(
    JSON.stringify(pack?.variables || {}),
    {},
    permission
  );

  return {
    identity: agent,
    variables: JSON.parse(resolvedVariables)
  };
};

export const listSnrAdjustmentLogs = async (
  context: AppContext,
  input: ListSnrAdjustmentLogsInput
) => {
  const agentId = typeof input.agent_id === 'string' ? input.agent_id.trim() : '';

  if (agentId.length === 0) {
    throw new ApiError(400, 'SNR_LOG_QUERY_INVALID', 'agent_id is required');
  }

  const requestedLimit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.trunc(input.limit)
      : DEFAULT_SNR_LOG_LIMIT;
  const limit = Math.min(MAX_SNR_LOG_LIMIT, Math.max(1, requestedLimit));

  return context.sim.prisma.sNRAdjustmentLog.findMany({
    where: {
      agent_id: agentId
    },
    orderBy: {
      created_at: 'desc'
    },
    take: limit
  });
};
