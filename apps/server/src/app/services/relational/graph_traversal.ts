import { isRecord } from './types.js';

export const buildRelayNodeId = (actionIntentId: string): string => {
  return `relay:${actionIntentId}`;
};

export const buildContainerNodeId = (actionIntentId: string): string => {
  return `container:${actionIntentId}`;
};

export const getNeighborhoodNodeIds = (
  rootId: string,
  depth: number,
  relationships: Array<{ from_id: string; to_id: string }>,
  atmosphereNodes: Array<{ id: string; owner_id: string }>,
  actionIntents: Array<{
    id: string;
    actor_ref: unknown;
    source_inference_id: string;
    status: string;
  }>
): Set<string> => {
  const visited = new Set<string>([rootId]);
  let frontier = new Set<string>([rootId]);

  for (let level = 0; level < depth; level += 1) {
    const next = new Set<string>();

    for (const nodeId of frontier) {
      for (const relationship of relationships) {
        if (relationship.from_id === nodeId && !visited.has(relationship.to_id)) {
          visited.add(relationship.to_id);
          next.add(relationship.to_id);
        }
        if (relationship.to_id === nodeId && !visited.has(relationship.from_id)) {
          visited.add(relationship.from_id);
          next.add(relationship.from_id);
        }
      }

      for (const atmosphereNode of atmosphereNodes) {
        if (atmosphereNode.owner_id === nodeId && !visited.has(atmosphereNode.id)) {
          visited.add(atmosphereNode.id);
          next.add(atmosphereNode.id);
        }
      }

      for (const intent of actionIntents) {
        const actorAgentId = isRecord(intent.actor_ref) && typeof intent.actor_ref.agent_id === 'string'
          ? intent.actor_ref.agent_id
          : null;
        const relayNodeId = buildRelayNodeId(intent.id);
        const containerNodeId = buildContainerNodeId(intent.id);

        if (actorAgentId === nodeId) {
          if (!visited.has(relayNodeId)) {
            visited.add(relayNodeId);
            next.add(relayNodeId);
          }
          if (intent.status === 'failed' && !visited.has(containerNodeId)) {
            visited.add(containerNodeId);
            next.add(containerNodeId);
          }
        }

        if (relayNodeId === nodeId && actorAgentId && !visited.has(actorAgentId)) {
          visited.add(actorAgentId);
          next.add(actorAgentId);
        }

        if (containerNodeId === nodeId && !visited.has(relayNodeId)) {
          visited.add(relayNodeId);
          next.add(relayNodeId);
        }
      }
    }

    frontier = next;
    if (frontier.size === 0) {
      break;
    }
  }

  return visited;
};
