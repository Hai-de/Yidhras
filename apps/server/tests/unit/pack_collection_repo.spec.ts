import fs from 'fs';

import { afterEach, describe, expect, it } from 'vitest';

import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';
import { installPackRuntime } from '../../src/kernel/install/install_pack.js';
import { parseWorldPackConstitution } from '../../src/packs/manifest/constitution_loader.js';
import {
  listDeclaredPackCollectionRecords,
  upsertDeclaredPackCollectionRecord
} from '../../src/packs/storage/pack_collection_repo.js';
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

describe('pack collection repo', () => {
  const packStorageAdapter = new SqlitePackStorageAdapter();

  it('upserts and lists declared pack collection records from the pack runtime sqlite database', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-storage-repo-pack',
        name: '存储仓库测试世界',
        version: '1.0.0'
      },
      storage: {
        strategy: 'isolated_pack_db',
        runtime_db_file: 'runtime.sqlite',
        pack_collections: [
          {
            key: 'target_dossiers',
            kind: 'table',
            primary_key: 'id',
            fields: [
              { key: 'id', type: 'string', required: true },
              { key: 'owner_actor_id', type: 'entity_ref', required: true },
              { key: 'target_entity_id', type: 'entity_ref', required: true },
              { key: 'confidence', type: 'number' },
              { key: 'content', type: 'json', required: true }
            ],
            indexes: [['owner_actor_id', 'target_entity_id']]
          }
        ],
        install: {
          compile_on_activate: true,
          allow_pack_collections: true,
          allow_raw_sql: false
        }
      }
    });

    await installPackRuntime(pack, packStorageAdapter);

    const upserted = await upsertDeclaredPackCollectionRecord('world-storage-repo-pack', 'target_dossiers', {
      id: 'dossier-001',
      owner_actor_id: 'agent-001',
      target_entity_id: 'agent-002',
      confidence: 0.85,
      content: {
        hypothesis: 'night-watch',
        notes: ['name-confirmed', 'face-confirmed']
      }
    });

    expect(upserted).toMatchObject({
      id: 'dossier-001',
      owner_actor_id: 'agent-001',
      target_entity_id: 'agent-002',
      confidence: 0.85
    });

    const listed = await listDeclaredPackCollectionRecords('world-storage-repo-pack', 'target_dossiers');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: 'dossier-001',
      owner_actor_id: 'agent-001',
      target_entity_id: 'agent-002'
    });
    expect((listed[0]?.content as Record<string, unknown>)?.hypothesis).toBe('night-watch');
  });
});
