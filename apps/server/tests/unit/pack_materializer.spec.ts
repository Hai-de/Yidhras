import fs from 'fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';
import { materializePackRuntime } from '../../src/core/pack_materializer.js';
import { parseWorldPackConstitution } from '../../src/packs/manifest/constitution_loader.js';
import { countSqliteEngineOwnedRecords } from '../../src/packs/storage/internal/sqlite_engine_owned_store.js';
import { SqlitePackStorageAdapter } from '../../src/packs/storage/internal/SqlitePackStorageAdapter.js';
import { createIsolatedRuntimeEnvironment } from '../helpers/runtime.js';

const createdRoots: string[] = [];

afterEach(() => {
  resetRuntimeConfigCache();
  delete process.env.WORKSPACE_ROOT;
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const createMockPrisma = () => {
  return {
    agent: {
      upsert: vi.fn(async () => ({ id: 'mock-agent' })),
      deleteMany: vi.fn(async () => ({ count: 0 }))
    },
    identity: {
      upsert: vi.fn(async () => ({ id: 'mock-identity' })),
      deleteMany: vi.fn(async () => ({ count: 0 }))
    },
    identityNodeBinding: {
      upsert: vi.fn(async () => ({ id: 'mock-binding' })),
      deleteMany: vi.fn(async () => ({ count: 0 }))
    }
  } as unknown as import('@prisma/client').PrismaClient;
};

const buildMinimalPack = (packId: string, packName = '测试世界') => {
  return parseWorldPackConstitution({
    metadata: {
      id: packId,
      name: packName,
      version: '1.0.0'
    },
    entities: {
      actors: [
        {
          id: 'actor-1',
          label: '测试角色',
          kind: 'actor',
          state: { alive: true }
        }
      ]
    }
  });
};

const buildPackWithStorage = (packId: string) => {
  return parseWorldPackConstitution({
    metadata: {
      id: packId,
      name: '带存储的世界',
      version: '1.0.0'
    },
    entities: {
      actors: [
        {
          id: 'actor-alpha',
          label: 'Alpha',
          kind: 'actor',
          state: { hp: 100 }
        }
      ]
    },
    storage: {
      strategy: 'isolated_pack_db',
      runtime_db_file: 'runtime.sqlite',
      engine_owned_collections: ['world_entities', 'authority_grants'],
      pack_collections: [
        {
          key: 'death_rule_targets',
          kind: 'table',
          primary_key: 'id',
          fields: [
            { key: 'id', type: 'string', required: true },
            { key: 'target_entity_id', type: 'entity_ref', required: true },
            { key: 'status', type: 'string', required: true }
          ]
        }
      ],
      install: {
        compile_on_activate: true,
        allow_pack_collections: true,
        allow_raw_sql: false
      }
    }
  });
};

describe('materializePackRuntime', () => {
  const packStorageAdapter = new SqlitePackStorageAdapter();

  it('materializes a fresh pack', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = buildMinimalPack('world-fresh-pack');
    const prisma = createMockPrisma();

    const result = await materializePackRuntime({
      pack,
      prisma,
      packStorageAdapter,
      initialTick: 0n
    });

    expect(result.install.packId).toBe('world-fresh-pack');
    expect(result.install.runtimeDbCreated).toBe(true);
    expect(fs.existsSync(result.install.runtimeDbPath)).toBe(true);

    expect(result.coreModels.world_entity_count).toBeGreaterThan(0);
    expect(result.coreModels.entity_state_count).toBeGreaterThan(0);

    expect(result.actorBridges.agent_count).toBeGreaterThan(0);
    expect(result.actorBridges.identity_count).toBeGreaterThan(0);
    expect(result.actorBridges.binding_count).toBeGreaterThan(0);

    const entityCount = await countSqliteEngineOwnedRecords(
      result.install.runtimeDbPath,
      'world_entities'
    );
    expect(entityCount).toBeGreaterThan(0);
  });

  it('idempotent: second call returns same counts', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = buildMinimalPack('world-idempotent-pack');
    const prisma = createMockPrisma();

    const first = await materializePackRuntime({
      pack,
      prisma,
      packStorageAdapter,
      initialTick: 0n
    });
    const second = await materializePackRuntime({
      pack,
      prisma,
      packStorageAdapter,
      initialTick: 0n
    });

    expect(second.install.runtimeDbCreated).toBe(false);

    expect(second.coreModels.world_entity_count).toBe(first.coreModels.world_entity_count);
    expect(second.coreModels.entity_state_count).toBe(first.coreModels.entity_state_count);
    expect(second.coreModels.authority_grant_count).toBe(first.coreModels.authority_grant_count);
    expect(second.coreModels.mediator_binding_count).toBe(first.coreModels.mediator_binding_count);

    expect(second.actorBridges.agent_count).toBe(first.actorBridges.agent_count);
  });

  it('creates runtime.sqlite and storage-plan.json', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = buildMinimalPack('world-structure-pack');
    const prisma = createMockPrisma();

    const result = await materializePackRuntime({
      pack,
      prisma,
      packStorageAdapter,
      initialTick: 0n
    });

    expect(fs.existsSync(result.install.runtimeDbPath)).toBe(true);

    const storagePlanPath = `${result.install.runtimeDbPath}.storage-plan.json`;
    expect(fs.existsSync(storagePlanPath)).toBe(true);

    const planContent = fs.readFileSync(storagePlanPath, 'utf-8');
    const plan = JSON.parse(planContent) as Record<string, unknown>;
    expect(plan.strategy).toBe('isolated_pack_db');
    expect(plan.runtime_db_file).toBe('runtime.sqlite');
  });

  it('actor bridges use pack-scoped IDs', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const packId = 'world-scoped-pack';
    const pack = buildMinimalPack(packId);
    const prisma = createMockPrisma();

    await materializePackRuntime({
      pack,
      prisma,
      packStorageAdapter,
      initialTick: 0n
    });

    const agentUpsertCalls = (prisma.agent.upsert as ReturnType<typeof vi.fn>).mock.calls as Array<
      Array<{ where: { id: string }; create: { id: string } }>
    >;
    expect(agentUpsertCalls.length).toBeGreaterThan(0);

    for (const call of agentUpsertCalls) {
      const agentId = call[0].where.id;
      expect(agentId).toMatch(new RegExp(`^${packId}:`));
    }

    const identityUpsertCalls = (prisma.identity.upsert as ReturnType<typeof vi.fn>).mock.calls as Array<
      Array<{ where: { id: string } }>
    >;
    expect(identityUpsertCalls.length).toBeGreaterThan(0);

    for (const call of identityUpsertCalls) {
      const identityId = call[0].where.id;
      expect(identityId).toMatch(new RegExp(`^${packId}:identity:`));
    }
  });

  it('handles pack without storage config', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = buildMinimalPack('world-no-storage');
    const prisma = createMockPrisma();

    const result = await materializePackRuntime({
      pack,
      prisma,
      packStorageAdapter,
      initialTick: 0n
    });

    expect(result.install.packId).toBe('world-no-storage');
    expect(result.install.runtimeDbCreated).toBe(true);
    expect(result.install.engineOwnedCollections.length).toBeGreaterThan(0);
    expect(result.install.packCollections).toEqual([]);
  });

  it('handles pack with custom pack_collections', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = buildPackWithStorage('world-custom-collections');
    const prisma = createMockPrisma();

    const result = await materializePackRuntime({
      pack,
      prisma,
      packStorageAdapter,
      initialTick: 0n
    });

    expect(result.install.packCollections).toEqual(['death_rule_targets']);

    const storagePlanPath = `${result.install.runtimeDbPath}.storage-plan.json`;
    const planContent = fs.readFileSync(storagePlanPath, 'utf-8');
    const plan = JSON.parse(planContent) as {
      pack_collections: Array<{ key: string; fields: Array<{ key: string }> }>;
    };

    const targetCollection = plan.pack_collections.find(c => c.key === 'death_rule_targets');
    expect(targetCollection).toBeDefined();
    expect(targetCollection!.fields.map(f => f.key)).toEqual(['id', 'target_entity_id', 'status']);
  });
});
