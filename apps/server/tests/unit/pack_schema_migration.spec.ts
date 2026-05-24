import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';
import { PackManifestLoader } from '../../src/packs/manifest/loader.js';
import { migrateConfig, planMigration } from '../../src/packs/migrations/registry.js';

const createdRoots: string[] = [];

const createTempPackRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yidhras-pack-migration-'));
  createdRoots.push(root);
  return root;
};

afterEach(async () => {
  vi.restoreAllMocks();
  resetRuntimeConfigCache();
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('pack schema migration framework', () => {
  it('plans and applies the current migration chain without changing manifest semantics', () => {
    const input = {
      schema_version: 0,
      metadata: {
        id: 'world-migration-test',
        name: '迁移测试世界',
        version: '1.0.0'
      }
    };

    const plan = planMigration(input);
    expect(plan).toMatchObject({
      currentVersion: 0,
      targetVersion: 1,
      latestVersion: 1,
      needsMigration: true
    });
    expect(plan.applied.map(migration => migration.version)).toEqual([1]);

    const result = migrateConfig(input);
    expect(result.config).toEqual({
      ...input,
      schema_version: 1
    });
    expect(result.applied.map(migration => migration.description)).toEqual([
      'Mark pack manifest as schema_version 1 without changing manifest semantics'
    ]);
  });

  it('rejects unsupported downgrade and future target versions', () => {
    expect(() => planMigration({ schema_version: 1 }, 0)).toThrow('Downgrading pack schema_version');
    expect(() => planMigration({ schema_version: 0 }, 2)).toThrow('newer than latest supported version 1');
  });

  it('warns during pack loading without rewriting an old pack manifest', async () => {
    const root = await createTempPackRoot();
    const packDir = path.join(root, 'legacy-pack');
    await mkdir(packDir, { recursive: true });

    const manifestPath = path.join(packDir, 'pack.yaml');
    const manifest = `schema_version: 0
metadata:
  id: world-legacy-pack
  name: 旧版本世界
  version: 1.0.0
`;
    await writeFile(manifestPath, manifest, 'utf-8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const loader = new PackManifestLoader(root);

    const pack = loader.loadPack('legacy-pack');

    expect(pack.schema_version).toBe(0);
    await expect(readFile(manifestPath, 'utf-8')).resolves.toBe(manifest);
    expect(warnSpy.mock.calls.some(call => String(call[0]).includes('latest supported schema_version is 1'))).toBe(true);
    expect(warnSpy.mock.calls.some(call => String(call[0]).includes('Loading continues without automatic migration'))).toBe(true);
  });
});
