import { PermissionContext } from '../../permission/types.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';

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
