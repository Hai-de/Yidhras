import type { PrismaClient } from '@prisma/client';

export const getGraphData = async (prisma: PrismaClient) => {
  const agents = await prisma.agent.findMany();
  const relations = await prisma.relationship.findMany();

  const nodes = agents.map(agent => ({
    data: {
      id: agent.id,
      label: agent.name,
      snr: agent.snr,
      type: agent.type,
      is_pinned: agent.is_pinned
    }
  }));

  const edges = relations.map(relationship => ({
    data: {
      id: relationship.id,
      source: relationship.from_id,
      target: relationship.to_id,
      type: relationship.type,
      weight: relationship.weight
    }
  }));

  return { nodes, edges };
};
