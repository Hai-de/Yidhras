import { describe, expect, it, vi } from 'vitest';

import { DefaultPackCatalogService } from '../../src/core/pack_catalog_service.js';
import { PrismaRuntimeDatabaseBootstrap } from '../../src/core/runtime_database_bootstrap.js';
import type { SqliteRuntimePragmaSnapshot } from '../../src/db/sqlite_runtime.js';
import type { WorldPack } from '../../src/packs/manifest/loader.js';

const createSnapshot = (): SqliteRuntimePragmaSnapshot => ({
  journal_mode: 'wal',
  busy_timeout: 5000,
  synchronous: 'NORMAL',
  foreign_keys: true,
  wal_autocheckpoint: 1000
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
    const snapshot = createSnapshot();
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
    expect(bootstrap.getSqliteRuntimePragmaSnapshot()).toBe(snapshot);
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

  it('resolves active pack by id or name before falling back to catalog scan', () => {
    const activePack = createPack('pack-active', 'Active Pack');
    const loader = {
      listAvailablePacks: () => ['active-folder', 'other-folder'],
      loadPack: vi.fn((folderName: string) => {
        if (folderName === 'active-folder') {
          return activePack;
        }

        return createPack('pack-other', 'Other Pack');
      })
    } as never;
    const catalog = new DefaultPackCatalogService({
      packsDir: '/tmp/world_packs',
      loader,
      getActivePack: () => activePack
    });

    expect(catalog.resolvePackByIdOrFolder('pack-active')).toEqual({
      pack: activePack,
      packFolderName: 'active-folder'
    });
    expect(catalog.resolvePackByIdOrFolder('Active Pack')).toEqual({
      pack: activePack,
      packFolderName: 'Active Pack'
    });
  });

  it('falls back to loader scan and finds folder name by pack id', () => {
    const alphaPack = createPack('pack-alpha', 'Alpha');
    const betaPack = createPack('pack-beta', 'Beta');
    const loader = {
      listAvailablePacks: () => ['alpha-folder', 'beta-folder'],
      loadPack: vi.fn((folderName: string) => {
        if (folderName === 'alpha-folder') {
          return alphaPack;
        }

        if (folderName === 'beta-folder') {
          return betaPack;
        }

        throw new Error(`unexpected folder ${folderName}`);
      })
    } as never;
    const catalog = new DefaultPackCatalogService({
      packsDir: '/tmp/world_packs',
      loader
    });

    expect(catalog.resolvePackByIdOrFolder('pack-beta')).toEqual({
      pack: betaPack,
      packFolderName: 'beta-folder'
    });
    expect(catalog.findFolderNameByPackId('pack-alpha')).toBe('alpha-folder');
    expect(catalog.resolvePackByIdOrFolder('   ')).toBeNull();
    expect(catalog.findFolderNameByPackId('missing-pack')).toBeNull();
  });
});
