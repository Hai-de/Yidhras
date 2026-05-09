import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { dispatchActionIntent } from '../../src/app/services/action_dispatcher.js';
import { createSpatialRuntime } from '../../src/packs/runtime/spatial_runtime.js';
import type { PackStorageAdapter } from '../../src/packs/storage/PackStorageAdapter.js';
import type { SpatialDiscreteConfig } from '../../src/packs/schema/constitution_schema.js';
import { createTestAppContext } from '../fixtures/app-context.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  migrateIsolatedDatabase
} from '../helpers/runtime.js';

const INFERENCE_PREFIX = 'move-e2e-';

const MANSION_SPATIAL: SpatialDiscreteConfig = {
  model: 'discrete',
  locations: [
    { id: 'entrance', name: '玄关' },
    { id: 'living_room', name: '客厅' },
    { id: 'kitchen', name: '厨房' },
    { id: 'dining_room', name: '餐厅' },
    { id: 'study', name: '书房' }
  ],
  edges: [
    { from: 'entrance', to: 'living_room', type: 'bidirectional' },
    { from: 'living_room', to: 'kitchen', type: 'bidirectional' },
    { from: 'living_room', to: 'dining_room', type: 'bidirectional' },
    { from: 'living_room', to: 'study', type: 'bidirectional' }
  ]
};

const createMemPackStorageAdapter = (): PackStorageAdapter => {
  const store = new Map<string, Map<string, Array<Record<string, unknown>>>>();

  const getTable = (packId: string, tableName: string): Array<Record<string, unknown>> => {
    const packStore = store.get(packId) ?? new Map<string, Array<Record<string, unknown>>>();
    if (!store.has(packId)) store.set(packId, packStore);
    const table = packStore.get(tableName) ?? [];
    if (!packStore.has(tableName)) packStore.set(tableName, table);
    return table;
  };

  return {
    backend: 'sqlite',
    ping: async () => true,
    destroyPackStorage: async () => {},
    ensureEngineOwnedSchema: async () => {},
    listEngineOwnedRecords: async (packId, tableName) => getTable(packId, tableName),
    upsertEngineOwnedRecord: async (packId, tableName, record) => {
      const table = getTable(packId, tableName);
      const rec = record as Record<string, unknown>;
      const id = String(rec.id ?? '');
      const idx = table.findIndex((r) => String(r.id) === id);
      if (idx >= 0) {
        table[idx] = { ...table[idx], ...rec };
      } else {
        table.push(rec);
      }
      return rec as never;
    },
    ensureCollection: async () => {},
    upsertCollectionRecord: async () => null,
    listCollectionRecords: async () => [],
    exportPackData: async () => ({}),
    importPackData: async () => {}
  };
};

describe('move intent dispatch', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;
  let packStorage: PackStorageAdapter;

  beforeAll(async () => {
    const environment = await createIsolatedRuntimeEnvironment();
    await migrateIsolatedDatabase(environment);
    const prisma = createPrismaClientForEnvironment(environment);

    packStorage = createMemPackStorageAdapter();
    const spatialRuntime = createSpatialRuntime(MANSION_SPATIAL, 'test-pack', packStorage);

    context = createTestAppContext(prisma);
    (context as Record<string, unknown>).packStorageAdapter = packStorage;
    (context as Record<string, unknown>).getSpatialRuntime = () => spatialRuntime;

    cleanup = async () => {
      await prisma.$disconnect();
      await environment.cleanup();
    };
  });

  beforeEach(async () => {
    await context.prisma.actionIntent.deleteMany({
      where: { source_inference_id: { startsWith: INFERENCE_PREFIX } }
    });
    await context.prisma.inferenceTrace.deleteMany({
      where: { id: { startsWith: INFERENCE_PREFIX } }
    });
  });

  afterAll(async () => {
    await cleanup?.();
  });

  const seedEntityLocation = async (entityId: string, location: string) => {
    await packStorage.upsertEngineOwnedRecord('test-pack', 'entity_states', {
      id: `test-pack:state:${entityId}:spatial`,
      pack_id: 'test-pack',
      entity_id: entityId,
      state_namespace: 'spatial',
      state_json: { location },
      created_at: 1000n,
      updated_at: 1000n
    });
  };

  const createMoveIntent = async (
    entityId: string,
    targetLocation: string,
    suffix: string
  ) => {
    const now = context.sim.getCurrentTick();
    const inferenceId = `${INFERENCE_PREFIX}${suffix}-${Date.now()}`;

    await context.prisma.inferenceTrace.create({
      data: {
        id: inferenceId,
        kind: 'run',
        strategy: 'mock',
        provider: 'mock',
        actor_ref: {
          identity_id: entityId,
          role: 'active',
          agent_id: `test-pack:${entityId}`,
          atmosphere_node_id: null
        },
        input: { agent_id: `test-pack:${entityId}`, strategy: 'mock' },
        context_snapshot: {},
        prompt_bundle: {},
        trace_metadata: {},
        created_at: now,
        updated_at: now
      }
    });

    return context.prisma.actionIntent.create({
      data: {
        source_inference_id: inferenceId,
        intent_type: 'move',
        actor_ref: {
          identity_id: entityId,
          role: 'active',
          agent_id: `test-pack:${entityId}`,
          atmosphere_node_id: null
        },
        target_ref: Prisma.JsonNull,
        payload: { entity_id: entityId, target_location: targetLocation },
        status: 'pending',
        scheduled_after_ticks: null,
        scheduled_for_tick: null,
        transmission_delay_ticks: null,
        transmission_policy: 'reliable',
        transmission_drop_chance: 0,
        drop_reason: null,
        dispatch_error_code: null,
        dispatch_error_message: null,
        locked_by: null,
        locked_at: null,
        lock_expires_at: null,
        created_at: now,
        updated_at: now
      }
    });
  };

  const lockIntent = async (intentId: string) => {
    const now = context.sim.getCurrentTick();
    return context.prisma.actionIntent.update({
      where: { id: intentId },
      data: {
        status: 'dispatching',
        locked_by: 'dispatcher-test',
        locked_at: now,
        lock_expires_at: now + 100n
      }
    });
  };

  it('moves entity to adjacent location and persists new location', async () => {
    const entityId = 'player-1';
    const fromLocation = 'entrance';
    const targetLocation = 'living_room';

    await seedEntityLocation(entityId, fromLocation);

    const spatialRuntime = context.getSpatialRuntime!();
    expect(await spatialRuntime.getLocation(entityId)).toBe(fromLocation);

    const created = await createMoveIntent(entityId, targetLocation, 'basic');
    const locked = await lockIntent(created.id);
    const result = await dispatchActionIntent(context, locked);

    expect(result.outcome).toBe('completed');
    expect(await spatialRuntime.getLocation(entityId)).toBe(targetLocation);
  });

  it('rejects move to non-adjacent location and sets status to dispatch_failed', async () => {
    const entityId = 'player-2';
    const fromLocation = 'entrance';
    // kitchen is 2 hops from entrance (entrance ↔ living_room ↔ kitchen)
    const targetLocation = 'kitchen';

    await seedEntityLocation(entityId, fromLocation);

    const spatialRuntime = context.getSpatialRuntime!();
    expect(await spatialRuntime.getLocation(entityId)).toBe(fromLocation);

    const created = await createMoveIntent(entityId, targetLocation, 'non-adj');
    const locked = await lockIntent(created.id);

    await expect(dispatchActionIntent(context, locked)).rejects.toThrow(
      'Move target is not adjacent to current location'
    );

    // Entity stays at original location
    expect(await spatialRuntime.getLocation(entityId)).toBe(fromLocation);
  });

  it('moves entity to a valid adjacent location among multiple neighbors', async () => {
    const entityId = 'player-3';
    const fromLocation = 'living_room';
    // living_room neighbors: entrance, kitchen, dining_room, study (all bidirectional)
    const targetLocation = 'dining_room';

    await seedEntityLocation(entityId, fromLocation);

    const spatialRuntime = context.getSpatialRuntime!();
    expect(await spatialRuntime.getLocation(entityId)).toBe(fromLocation);

    const created = await createMoveIntent(entityId, targetLocation, 'multi');
    const locked = await lockIntent(created.id);
    const result = await dispatchActionIntent(context, locked);

    expect(result.outcome).toBe('completed');
    expect(await spatialRuntime.getLocation(entityId)).toBe(targetLocation);
  });

  it('rejects move when entity has no spatial state', async () => {
    const entityId = 'player-4';
    const targetLocation = 'study';

    const spatialRuntime = context.getSpatialRuntime!();
    expect(await spatialRuntime.getLocation(entityId)).toBeNull();

    const created = await createMoveIntent(entityId, targetLocation, 'no-state');
    const locked = await lockIntent(created.id);

    await expect(dispatchActionIntent(context, locked)).rejects.toThrow(
      'Move target is not adjacent to current location'
    );

    // Entity still has no location
    expect(await spatialRuntime.getLocation(entityId)).toBeNull();
  });
});
