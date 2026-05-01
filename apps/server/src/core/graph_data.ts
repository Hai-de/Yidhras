export interface GraphDataQuery {
  listAgents(): Promise<Array<{ id: string; name: string; snr: number; type: string; is_pinned: boolean }>>;
  listRelationships(): Promise<Array<{ id: string; from_id: string; to_id: string; type: string; weight: number }>>;
}

export const getGraphData = async (query: GraphDataQuery) => {
  const agents = await query.listAgents();
  const relations = await query.listRelationships();

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
