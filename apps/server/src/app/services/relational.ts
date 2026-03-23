import type { AppContext } from '../context.js';

export interface ListAtmosphereNodesInput {
  owner_id?: string;
  include_expired?: boolean;
}

export const getRelationalGraph = async (context: AppContext) => {
  return context.sim.getGraphData();
};

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
