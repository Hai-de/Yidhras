import { compilePackStoragePlan } from '../../packs/compiler/compile_pack_storage.js';
import { planMigration } from '../../packs/migrations/registry.js';
import type { WorldPack } from '../../packs/schema/constitution_schema.js';
import { createPackStorageEngine, type PackStorageMaterializeSummary } from '../../packs/storage/pack_storage_engine.js';
import type { PackStorageAdapter } from '../../packs/storage/PackStorageAdapter.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('pack-install');

export interface InstalledPackRuntimeSummary {
  packId: string;
  runtimeDbPath: string;
  runtimeDbCreated: boolean;
  engineOwnedCollections: string[];
  packCollections: string[];
}

export const installPackRuntime = async (instanceId: string, pack: WorldPack, packStorageAdapter: PackStorageAdapter): Promise<InstalledPackRuntimeSummary> => {
  const migrationPlan = planMigration(pack);
  if (migrationPlan.needsMigration) {
    logger.warn(
      `Pack ${pack.metadata.id} uses schema_version ${String(migrationPlan.currentVersion)}; ` +
      `latest supported schema_version is ${String(migrationPlan.latestVersion)}. ` +
      'Runtime installation continues without automatic migration.',
      {
        pack_id: pack.metadata.id,
        current_schema_version: migrationPlan.currentVersion,
        latest_schema_version: migrationPlan.latestVersion
      }
    );
  }

  const compiledStorage = compilePackStoragePlan(pack);
  const storageEngine = createPackStorageEngine(packStorageAdapter);
  const materialized = await storageEngine.materializeStoragePlan(instanceId, {
    strategy: compiledStorage.strategy,
    runtime_db_file: compiledStorage.runtimeDbFile,
    engine_owned_collections: compiledStorage.engineOwnedCollections,
    pack_collections: compiledStorage.packCollections,
    projections: compiledStorage.projections,
    install: compiledStorage.installPolicy
  });

  return toInstalledPackRuntimeSummary(materialized);
};

const toInstalledPackRuntimeSummary = (
  materialized: PackStorageMaterializeSummary
): InstalledPackRuntimeSummary => {
  return {
    packId: materialized.location.packId,
    runtimeDbPath: materialized.location.runtimeDbPath,
    runtimeDbCreated: materialized.runtimeDbCreated,
    engineOwnedCollections: materialized.engineOwnedCollections,
    packCollections: materialized.packCollections
  };
};
