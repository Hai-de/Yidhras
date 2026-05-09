import type { SpatialDiscreteConfig } from '@yidhras/contracts';

import { listPackEntityStates, upsertPackEntityState } from '../storage/entity_state_repo.js';
import type { PackStorageAdapter } from '../storage/PackStorageAdapter.js';

const SPATIAL_NAMESPACE = 'spatial';

interface SpatialState {
  location: string;
}

export interface SpatialRuntime {
  readonly model: 'discrete';
  getLocation(entityId: string): Promise<string | null>;
  neighbors(locationId: string): string[];
  distance(a: string, b: string): number | null;
  moveEntity(entityId: string, targetLocation: string, now: bigint): Promise<void>;
}

const buildAdjacencyMap = (config: SpatialDiscreteConfig): Map<string, Set<string>> => {
  const map = new Map<string, Set<string>>();

  const addEdge = (from: string, to: string): void => {
    if (!map.has(from)) {
      map.set(from, new Set());
    }
    map.get(from)!.add(to);
  };

  for (const edge of config.edges) {
    addEdge(edge.from, edge.to);
    if (edge.type === 'bidirectional') {
      addEdge(edge.to, edge.from);
    }
  }

  for (const location of config.locations) {
    if (!map.has(location.id)) {
      map.set(location.id, new Set());
    }
  }

  return map;
};

const bfsDistance = (adjacency: Map<string, Set<string>>, from: string, to: string): number | null => {
  if (from === to) {
    return 0;
  }
  const visited = new Set<string>();
  const queue: Array<[string, number]> = [[from, 0]];
  visited.add(from);

  while (queue.length > 0) {
    const [current, dist] = queue.shift()!;
    const neighbors = adjacency.get(current);
    if (!neighbors) {
      continue;
    }
    for (const neighbor of neighbors) {
      if (neighbor === to) {
        return dist + 1;
      }
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([neighbor, dist + 1]);
      }
    }
  }

  return null;
};

const parseSpatialState = (stateJson: unknown): SpatialState | null => {
  if (stateJson !== null && typeof stateJson === 'object' && 'location' in (stateJson as Record<string, unknown>)) {
    const location = (stateJson as Record<string, unknown>).location;
    if (typeof location === 'string') {
      return { location };
    }
  }
  return null;
};

const buildEntityStateId = (packId: string, entityId: string): string =>
  `${packId}:state:${entityId}:${SPATIAL_NAMESPACE}`;

export const createSpatialRuntime = (
  config: SpatialDiscreteConfig,
  packId: string,
  storageAdapter: PackStorageAdapter
): SpatialRuntime => {
  const adjacency = buildAdjacencyMap(config);

  return {
    model: 'discrete',

    async getLocation(entityId: string): Promise<string | null> {
      const stateId = buildEntityStateId(packId, entityId);
      const states = await listPackEntityStates(storageAdapter, packId);
      const spatialState = states.find((s) => s.id === stateId);
      if (!spatialState) {
        return null;
      }
      const parsed = parseSpatialState(spatialState.state_json);
      return parsed?.location ?? null;
    },

    neighbors(locationId: string): string[] {
      const neighborSet = adjacency.get(locationId);
      if (!neighborSet) {
        return [];
      }
      return [...neighborSet];
    },

    distance(a: string, b: string): number | null {
      return bfsDistance(adjacency, a, b);
    },

    async moveEntity(entityId: string, targetLocation: string, now: bigint): Promise<void> {
      if (!adjacency.has(targetLocation)) {
        throw new Error(`Location "${targetLocation}" not found in spatial config`);
      }

      const input = {
        id: buildEntityStateId(packId, entityId),
        pack_id: packId,
        entity_id: entityId,
        state_namespace: SPATIAL_NAMESPACE,
        state_json: { location: targetLocation } as Record<string, unknown>,
        now
      };

      await upsertPackEntityState(storageAdapter, input);
    }
  };
};
