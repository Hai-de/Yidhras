import type { SpatialDiscreteConfig } from '@yidhras/contracts';

import { listPackWorldEntities } from '../storage/entity_repo.js';
import { listPackEntityStates, upsertPackEntityState } from '../storage/entity_state_repo.js';
import type { PackStorageAdapter } from '../storage/PackStorageAdapter.js';

const SPATIAL_NAMESPACE = 'spatial';
const DOMAIN_NAMESPACE = 'domain';

interface SpatialState {
  location: string;
}

export interface LocationState {
  label: string;
  publicDescription: string | null;
  hiddenDetails: string | string[] | null;
  tags: string[];
}

export interface SpatialRuntime {
  readonly model: 'discrete';
  getLocation(entityId: string): Promise<string | null>;
  getLocationState(locationId: string): Promise<LocationState | null>;
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- map.has/set above guarantees key exists
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- while queue.length > 0 guard
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- pack manifest parsing
  if (stateJson !== null && typeof stateJson === 'object' && 'location' in (stateJson as Record<string, unknown>)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- pack manifest parsing
    const location = (stateJson as Record<string, unknown>).location;
    if (typeof location === 'string') {
      return { location };
    }
  }
  return null;
};

const parseHiddenDetails = (raw: unknown): string | string[] | null => {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const filtered = raw.filter((d): d is string => typeof d === 'string');
    return filtered.length > 0 ? filtered : null;
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

  const labelMap = new Map<string, string>();
  let labelMapLoaded = false;

  // Cache for listPackEntityStates — invalidated on mutation
  let cachedStates: Awaited<ReturnType<typeof listPackEntityStates>> | null = null;

  const ensureLabelMap = async (): Promise<void> => {
    if (labelMapLoaded) return;
    const entities = await listPackWorldEntities(storageAdapter, packId);
    for (const entity of entities) {
      if (entity.entity_kind === 'domain') {
        labelMap.set(entity.id, entity.label);
      }
    }
    labelMapLoaded = true;
  };

  const getCachedStates = async (): Promise<Awaited<ReturnType<typeof listPackEntityStates>>> => {
    // Cache is per-request, not per-tick, to avoid stale data within a tick.
    // Each context assembly run refreshes independently.
    if (cachedStates) return cachedStates;
    cachedStates = await listPackEntityStates(storageAdapter, packId);
    return cachedStates;
  };

  return {
    model: 'discrete',

    async getLocation(entityId: string): Promise<string | null> {
      const stateId = buildEntityStateId(packId, entityId);
      const states = await getCachedStates();
      const spatialState = states.find((s) => s.id === stateId);
      if (!spatialState) {
        return null;
      }
      const parsed = parseSpatialState(spatialState.state_json);
      return parsed?.location ?? null;
    },

    async getLocationState(locationId: string): Promise<LocationState | null> {
      await ensureLabelMap();

      const stateId = `${packId}:state:${locationId}:${DOMAIN_NAMESPACE}`;
      const states = await getCachedStates();
      const domainState = states.find((s) => s.id === stateId);

      const label = labelMap.get(locationId) ?? locationId;

      if (!domainState) {
        return { label, publicDescription: null, hiddenDetails: null, tags: [] };
      }

      const stateJson = domainState.state_json;
      const publicDescription =
        (typeof stateJson.public_description === 'string' ? stateJson.public_description : null) ??
        (typeof stateJson.description === 'string' ? stateJson.description : null);
      const hiddenDetails = parseHiddenDetails(stateJson.hidden_details);
      const tags = Array.isArray(stateJson.tags)
        ? stateJson.tags.filter((t): t is string => typeof t === 'string')
        : [];

      return { label, publicDescription, hiddenDetails, tags };
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

      // Invalidate cache on mutation
      cachedStates = null;

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
