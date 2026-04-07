import fs from 'fs';

import { afterEach, describe, expect, it } from 'vitest';

import { installPackRuntime } from '../../src/kernel/install/install_pack.js';
import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';
import { countSqliteEngineOwnedRecords } from '../../src/packs/storage/internal/sqlite_engine_owned_store.js';
import { createIsolatedRuntimeEnvironment } from '../helpers/runtime.js';

import { parseWorldPackConstitution } from '../../src/packs/manifest/constitution_loader.js';

const createdRoots: string[] = [];

afterEach(() => {
  resetRuntimeConfigCache();
  delete process.env.WORKSPACE_ROOT;
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('pack runtime install', () => {
  it('materializes a pack runtime database file and storage plan metadata', async () => {
    const environment = await createIsolatedRuntimeEnvironment({
      appEnv: 'test'
    });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-test-pack',
        name: '测试世界',
        version: '1.0.0'
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

    const summary = await installPackRuntime(pack);

    expect(summary.packId).toBe('world-test-pack');
    expect(summary.runtimeDbCreated).toBe(true);
    expect(fs.existsSync(summary.runtimeDbPath)).toBe(true);
    expect(fs.existsSync(`${summary.runtimeDbPath}.storage-plan.json`)).toBe(true);
    expect(summary.packCollections).toEqual(['death_rule_targets']);
    await expect(countSqliteEngineOwnedRecords(summary.runtimeDbPath, 'world_entities')).resolves.toBe(0);
    await expect(countSqliteEngineOwnedRecords(summary.runtimeDbPath, 'authority_grants')).resolves.toBe(0);
  });
});
