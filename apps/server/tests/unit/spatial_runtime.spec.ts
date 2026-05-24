import type { SpatialDiscreteConfig } from '@yidhras/contracts';
import { describe, expect, it } from 'vitest';

import { createSpatialRuntime } from '../../src/packs/runtime/spatial_runtime.js';
import type { PackStorageAdapter } from '../../src/packs/storage/PackStorageAdapter.js';

const TEST_PACK_ID = 'test-pack';

const createMockStorage = (initialStates: Record<string, string> = {}): PackStorageAdapter => {
  const states = new Map<string, Record<string, unknown>>();

  for (const [entityId, locationId] of Object.entries(initialStates)) {
    const stateId = `${TEST_PACK_ID}:state:${entityId}:spatial`;
    states.set(stateId, {
      id: stateId,
      pack_id: TEST_PACK_ID,
      entity_id: entityId,
      state_namespace: 'spatial',
      state_json: { location: locationId }
    });
  }

  return {
    backend: 'sqlite',
    ping: async () => true,
    destroyPackStorage: async () => {},
    ensureEngineOwnedSchema: async () => {},
    listEngineOwnedRecords: async <T = Record<string, unknown>>(): Promise<T[]> => {
      return [...states.values()] as unknown as T[];
    },
    upsertEngineOwnedRecord: async <T = Record<string, unknown>>(_packId: string, _table: string, record: T): Promise<T> => {
      const r = record as Record<string, unknown>;
      states.set(r.id as string, r);
      return record;
    },
    ensureCollection: async () => {},
    upsertCollectionRecord: async () => null,
    listCollectionRecords: async () => [],
    exportPackData: async () => ({}),
    importPackData: async () => {}
  };
};

const buildConfig = (
  locations: string[],
  edges: Array<{ from: string; to: string; type?: 'bidirectional' | 'directed' }> = []
): SpatialDiscreteConfig => ({
  model: 'discrete',
  locations: locations.map((id) => ({ id })),
  edges: edges.map((e) => ({ ...e, type: e.type ?? 'bidirectional', weight: 1 }))
});

describe('SpatialRuntime', () => {
  describe('neighbors', () => {
    it('returns empty array for isolated location', () => {
      const runtime = createSpatialRuntime(buildConfig(['a', 'b']), TEST_PACK_ID, createMockStorage());
      expect(runtime.neighbors('a')).toEqual([]);
    });

    it('returns neighbors for bidirectional edges', () => {
      const runtime = createSpatialRuntime(
        buildConfig(['a', 'b', 'c'], [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' }
        ]),
        TEST_PACK_ID,
        createMockStorage()
      );
      expect(runtime.neighbors('a')).toEqual(['b']);
      expect(runtime.neighbors('b').sort()).toEqual(['a', 'c']);
      expect(runtime.neighbors('c')).toEqual(['b']);
    });

    it('handles directed edges', () => {
      const runtime = createSpatialRuntime(
        buildConfig(['a', 'b'], [{ from: 'a', to: 'b', type: 'directed' }]),
        TEST_PACK_ID,
        createMockStorage()
      );
      expect(runtime.neighbors('a')).toEqual(['b']);
      expect(runtime.neighbors('b')).toEqual([]);
    });

    it('returns empty array for unknown location', () => {
      const runtime = createSpatialRuntime(buildConfig(['a']), TEST_PACK_ID, createMockStorage());
      expect(runtime.neighbors('unknown')).toEqual([]);
    });

    it('isolated locations get empty neighbor sets', () => {
      const runtime = createSpatialRuntime(
        buildConfig(['a', 'b', 'c'], [{ from: 'a', to: 'b' }]),
        TEST_PACK_ID,
        createMockStorage()
      );
      expect(runtime.neighbors('c')).toEqual([]);
    });
  });

  describe('distance', () => {
    it('returns 0 for same location', () => {
      const runtime = createSpatialRuntime(buildConfig(['a', 'b']), TEST_PACK_ID, createMockStorage());
      expect(runtime.distance('a', 'a')).toBe(0);
    });

    it('returns 1 for adjacent locations', () => {
      const runtime = createSpatialRuntime(
        buildConfig(['a', 'b'], [{ from: 'a', to: 'b' }]),
        TEST_PACK_ID,
        createMockStorage()
      );
      expect(runtime.distance('a', 'b')).toBe(1);
    });

    it('returns correct BFS distance', () => {
      const runtime = createSpatialRuntime(
        buildConfig(['a', 'b', 'c', 'd'], [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' },
          { from: 'c', to: 'd' }
        ]),
        TEST_PACK_ID,
        createMockStorage()
      );
      expect(runtime.distance('a', 'd')).toBe(3);
      expect(runtime.distance('a', 'c')).toBe(2);
    });

    it('returns null for unreachable locations', () => {
      const runtime = createSpatialRuntime(buildConfig(['a', 'b']), TEST_PACK_ID, createMockStorage());
      expect(runtime.distance('a', 'b')).toBeNull();
    });

    it('returns null for unknown location', () => {
      const runtime = createSpatialRuntime(buildConfig(['a']), TEST_PACK_ID, createMockStorage());
      expect(runtime.distance('a', 'unknown')).toBeNull();
    });
  });

  describe('getLocation', () => {
    it('returns location from entity state', async () => {
      const storage = createMockStorage({ 'actor-1': 'kitchen' });
      const runtime = createSpatialRuntime(buildConfig(['kitchen']), TEST_PACK_ID, storage);
      const location = await runtime.getLocation('actor-1');
      expect(location).toBe('kitchen');
    });

    it('returns null for entity without spatial state', async () => {
      const runtime = createSpatialRuntime(buildConfig(['kitchen']), TEST_PACK_ID, createMockStorage());
      const location = await runtime.getLocation('actor-1');
      expect(location).toBeNull();
    });

    it('returns null for entity with invalid state_json', async () => {
      const storage: PackStorageAdapter = {
        ...createMockStorage(),
        listEngineOwnedRecords: async <T = Record<string, unknown>>(): Promise<T[]> => {
          return [
            {
              id: `${TEST_PACK_ID}:state:actor-1:spatial`,
              pack_id: TEST_PACK_ID,
              entity_id: 'actor-1',
              state_namespace: 'spatial',
              state_json: { not_location: 'x' }
            }
          ] as unknown as T[];
        }
      };
      const runtime = createSpatialRuntime(buildConfig(['kitchen']), TEST_PACK_ID, storage);
      const location = await runtime.getLocation('actor-1');
      expect(location).toBeNull();
    });
  });

  describe('moveEntity', () => {
    it('updates entity spatial state', async () => {
      const storage = createMockStorage({ 'actor-1': 'kitchen' });
      const runtime = createSpatialRuntime(
        buildConfig(['kitchen', 'library'], [{ from: 'kitchen', to: 'library' }]),
        TEST_PACK_ID,
        storage
      );

      await runtime.moveEntity('actor-1', 'library', 1000n);
      const location = await runtime.getLocation('actor-1');
      expect(location).toBe('library');
    });

    it('throws for unknown target location', async () => {
      const runtime = createSpatialRuntime(buildConfig(['kitchen']), TEST_PACK_ID, createMockStorage());
      await expect(runtime.moveEntity('actor-1', 'unknown', 1000n)).rejects.toThrow('Location "unknown" not found');
    });
  });

  describe('model', () => {
    it('reports model as discrete', () => {
      const runtime = createSpatialRuntime(buildConfig(['a']), TEST_PACK_ID, createMockStorage());
      expect(runtime.model).toBe('discrete');
    });
  });
});
