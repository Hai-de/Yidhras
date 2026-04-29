import { safeFs } from '../../utils/safe_fs.js';
import type { WorldPackStorage, WorldPackStorageCollectionDefinition } from '../schema/storage_schema.js';
import { type PersistedStoragePlan, writePersistedStoragePlan } from './internal/plan_store.js';
import { ensurePackRuntimeDirectory, type PackRuntimeDatabaseLocation } from './pack_db_locator.js';
import type { CollectionFieldType, PackStorageAdapter } from './PackStorageAdapter.js';

export interface PackStorageMaterializeSummary {
  location: PackRuntimeDatabaseLocation;
  runtimeDbExisted: boolean;
  runtimeDbCreated: boolean;
  engineOwnedCollections: string[];
  packCollections: string[];
}

const toPersistedStoragePlan = (
  storage: WorldPackStorage,
  packCollections: WorldPackStorageCollectionDefinition[]
): PersistedStoragePlan => {
  return {
    strategy: storage.strategy,
    runtime_db_file: storage.runtime_db_file,
    engine_owned_collections: storage.engine_owned_collections,
    pack_collections: packCollections.map(collection => ({
      key: collection.key,
      kind: collection.kind,
      primary_key: collection.primary_key,
      fields: collection.fields,
      indexes: collection.indexes ?? []
    })),
    projections: storage.projections,
    install: storage.install
  };
};

export class PackStorageEngine {
  private readonly adapter: PackStorageAdapter;

  constructor(adapter: PackStorageAdapter) {
    this.adapter = adapter;
  }

  public async materializeStoragePlan(
    packId: string,
    storage: WorldPackStorage
  ): Promise<PackStorageMaterializeSummary> {
    const location = ensurePackRuntimeDirectory(packId, storage.runtime_db_file);
    const runtimeDbExisted = safeFs.existsSync(location.packRootDir, location.runtimeDbPath);
    const storagePlanPath = `${location.runtimeDbPath}.storage-plan.json`;

    await this.adapter.ensureEngineOwnedSchema(packId);

    const persistedPlan = toPersistedStoragePlan(storage, storage.pack_collections);

    for (const collection of persistedPlan.pack_collections) {
      await this.adapter.ensureCollection(packId, {
        key: collection.key,
        kind: collection.kind,
        primary_key: collection.primary_key,
        fields: collection.fields.map(f => ({ name: f.key, type: f.type as CollectionFieldType, required: f.required })),
        indexes: collection.indexes?.map(idx => ({ columns: idx }))
      });
    }

    writePersistedStoragePlan(location.packRootDir, storagePlanPath, persistedPlan);

    return {
      location,
      runtimeDbExisted,
      runtimeDbCreated: !runtimeDbExisted,
      engineOwnedCollections: [...storage.engine_owned_collections],
      packCollections: storage.pack_collections.map(collection => collection.key)
    };
  }
}

export const createPackStorageEngine = (adapter: PackStorageAdapter): PackStorageEngine => {
  return new PackStorageEngine(adapter);
};
