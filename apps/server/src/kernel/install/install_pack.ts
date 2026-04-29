import { compilePackStoragePlan } from '../../packs/compiler/compile_pack_storage.js';
import type { WorldPack } from '../../packs/schema/constitution_schema.js';
import { createPackStorageEngine, type PackStorageMaterializeSummary } from '../../packs/storage/pack_storage_engine.js';
import type { PackStorageAdapter } from '../../packs/storage/PackStorageAdapter.js';

export interface InstalledPackRuntimeSummary {
  packId: string;
  runtimeDbPath: string;
  runtimeDbCreated: boolean;
  engineOwnedCollections: string[];
  packCollections: string[];
}

export const installPackRuntime = async (pack: WorldPack, packStorageAdapter: PackStorageAdapter): Promise<InstalledPackRuntimeSummary> => {
  const compiledStorage = compilePackStoragePlan(pack);
  const storageEngine = createPackStorageEngine(packStorageAdapter);
  const materialized = await storageEngine.materializeStoragePlan(pack.metadata.id, {
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
