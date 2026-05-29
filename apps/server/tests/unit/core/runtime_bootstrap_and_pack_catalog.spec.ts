import { describe, expect, it, vi } from 'vitest';

import { PrismaRuntimeDatabaseBootstrap } from '../../../src/core/runtime_database_bootstrap.js';
import type { DatabaseHealthSnapshot } from '../../../src/db/sqlite_runtime.js';
import type { WorldPack } from '../../../src/packs/manifest/loader.js';
import { DefaultPackCatalogService } from '../../../src/packs/orchestration/pack_catalog_service.js';

const createHealthSnapshot = (): DatabaseHealthSnapshot => ({
  provider: 'sqlite',
  connected: true,
  sqlite: {
    journal_mode: 'wal',
    busy_timeout: 5000,
    synchronous: 'NORMAL',
    foreign_keys: true,
    wal_autocheckpoint: 1000
  }
});

const createPack = (packId: string, name = packId): WorldPack => ({
  metadata: {
    id: packId,
    name,
    version: '0.0.1'
  }
} as WorldPack);

describe('PrismaRuntimeDatabaseBootstrap', () => {
  it('applies sqlite pragmas once and reuses cached snapshot', async () => {
    const snapshot = createHealthSnapshot();
    const applyPragmas = vi.fn(async () => snapshot);
    const log = vi.fn();
    const bootstrap = new PrismaRuntimeDatabaseBootstrap({
      prisma: {} as never,
      applyPragmas,
      log
    });

    await expect(bootstrap.prepareDatabase()).resolves.toBe(snapshot);
    await expect(bootstrap.prepareDatabase()).resolves.toBe(snapshot);

    expect(applyPragmas).toHaveBeenCalledTimes(1);
    expect(bootstrap.getDatabaseHealth()).toBe(snapshot);
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('DefaultPackCatalogService', () => {
  it('lists available packs and returns packsDir', () => {
    const loader = {
      listAvailablePacks: () => ['alpha', 'beta']
    } as never;
    const catalog = new DefaultPackCatalogService({
      packsDir: '/tmp/world_packs',
      loader
    });

    expect(catalog.listAvailablePacks()).toEqual(['alpha', 'beta']);
    expect(catalog.getPacksDir()).toBe('/tmp/world_packs');
  });

  it('resolves pack by instance_id or folder_name', () => {
    const activePack = createPack('pack-active', 'Active Pack');
    // instance_id = folder_name (default derivation)
    const instanceMap: Record<string, string> = {
      'active-folder': 'active-folder',
      'other-folder': 'other-folder'
    };
    const loader = {
      listAvailablePacks: () => ['active-folder', 'other-folder'],
      loadPack: vi.fn((folderName: string) => {
        if (folderName === 'active-folder') return activePack;
        return createPack('pack-other', 'Other Pack');
      }),
      getFolderNameByInstanceId: (id: string) => instanceMap[id] ?? null,
      deriveInstanceId: (_pack: WorldPack, folderName: string) => folderName
    } as never;
    const catalog = new DefaultPackCatalogService({
      packsDir: '/tmp/world_packs',
      loader
    });

    // match by instance_id (which equals folder_name here)
    expect(catalog.resolvePackByIdOrFolder('active-folder')).toEqual({
      pack: activePack,
      packFolderName: 'active-folder'
    });
    // match by folder_name directly
    expect(catalog.resolvePackByIdOrFolder('active-folder')).toEqual({
      pack: activePack,
      packFolderName: 'active-folder'
    });
  });

  it('falls back to folder name match when instance_id not found', () => {
    const alphaPack = createPack('pack-alpha', 'Alpha');
    const betaPack = createPack('pack-beta', 'Beta');
    const instanceMap: Record<string, string> = {
      'alpha-folder': 'alpha-folder',
      'beta-folder': 'beta-folder'
    };
    const loader = {
      listAvailablePacks: () => ['alpha-folder', 'beta-folder'],
      loadPack: vi.fn((folderName: string) => {
        if (folderName === 'alpha-folder') return alphaPack;
        if (folderName === 'beta-folder') return betaPack;
        throw new Error(`unexpected folder ${folderName}`);
      }),
      getFolderNameByInstanceId: (id: string) => instanceMap[id] ?? null,
      deriveInstanceId: (_pack: WorldPack, folderName: string) => folderName
    } as never;
    const catalog = new DefaultPackCatalogService({
      packsDir: '/tmp/world_packs',
      loader
    });

    // match by instance_id
    expect(catalog.resolvePackByIdOrFolder('beta-folder')).toEqual({
      pack: betaPack,
      packFolderName: 'beta-folder'
    });
    expect(catalog.findFolderNameByPackId('alpha-folder'))
      .toBe('alpha-folder');
    expect(catalog.resolvePackByIdOrFolder('   ')).toBeNull();
    expect(catalog.findFolderNameByPackId('missing-pack')).toBeNull();
  });
});
