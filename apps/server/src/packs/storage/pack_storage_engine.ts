import fs from 'fs';

import type { WorldPackStorage, WorldPackStorageCollectionDefinition } from '../schema/storage_schema.js';
import { asMutablePlanRecord, type PersistedStoragePlan,readPersistedStoragePlan, writePersistedStoragePlan } from './internal/plan_store.js';
import { ensureDeclaredPackCollectionTables } from './pack_collection_repo.js';
import {
  ensurePackRuntimeSqliteStorage,
  packRuntimeAuthorityGrantTableSpec,
  packRuntimeEntityStateTableSpec,
  packRuntimeMediatorBindingTableSpec,
  packRuntimeRuleExecutionTableSpec,
  packRuntimeWorldEntityTableSpec,
  seedSqliteEngineOwnedRecordsIfEmpty,
  type SqliteEngineOwnedTableSpec
} from './internal/sqlite_engine_owned_store.js';
import { ensurePackRuntimeDirectory, type PackRuntimeDatabaseLocation } from './pack_db_locator.js';

export interface PackStorageMaterializeSummary {
  location: PackRuntimeDatabaseLocation;
  runtimeDbExisted: boolean;
  runtimeDbCreated: boolean;
  engineOwnedCollections: string[];
  packCollections: string[];
}


const LEGACY_SQLITE_MIGRATION_SPECS = {
  world_entities: packRuntimeWorldEntityTableSpec,
  entity_states: packRuntimeEntityStateTableSpec,
  authority_grants: packRuntimeAuthorityGrantTableSpec,
  mediator_bindings: packRuntimeMediatorBindingTableSpec,
  rule_execution_records: packRuntimeRuleExecutionTableSpec
} satisfies Record<string, SqliteEngineOwnedTableSpec<unknown>>;

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

const migrateLegacyEngineOwnedCollections = async (
  runtimeDbPath: string,
  existingPlan: PersistedStoragePlan | null
): Promise<void> => {
  if (!existingPlan) {
    return;
  }

  const mutablePlan = asMutablePlanRecord(existingPlan);
  for (const [collectionKey, spec] of Object.entries(LEGACY_SQLITE_MIGRATION_SPECS)) {
    const legacyRows = mutablePlan[collectionKey];
    if (!Array.isArray(legacyRows) || legacyRows.length === 0) {
      continue;
    }
    await seedSqliteEngineOwnedRecordsIfEmpty(
      runtimeDbPath,
      spec,
      legacyRows.map(row => spec.decode((row ?? {}) as Record<string, unknown>))
    );
  }
};

export class PackStorageEngine {
  public async materializeStoragePlan(packId: string, storage: WorldPackStorage): Promise<PackStorageMaterializeSummary> {
    const location = ensurePackRuntimeDirectory(packId, storage.runtime_db_file);
    const runtimeDbExisted = fs.existsSync(location.runtimeDbPath);
    const storagePlanPath = `${location.runtimeDbPath}.storage-plan.json`;

    if (!runtimeDbExisted) {
      fs.writeFileSync(location.runtimeDbPath, '', 'utf-8');
    }

    const existingPlan = readPersistedStoragePlan(storagePlanPath);
    await ensurePackRuntimeSqliteStorage(location.runtimeDbPath);
    await migrateLegacyEngineOwnedCollections(location.runtimeDbPath, existingPlan);
    await ensureDeclaredPackCollectionTables(location.runtimeDbPath, storage.pack_collections);

    writePersistedStoragePlan(storagePlanPath, toPersistedStoragePlan(storage, storage.pack_collections));

    return {
      location,
      runtimeDbExisted,
      runtimeDbCreated: !runtimeDbExisted,
      engineOwnedCollections: [...storage.engine_owned_collections],
      packCollections: storage.pack_collections.map(collection => collection.key)
    };
  }
}

export const createPackStorageEngine = (): PackStorageEngine => {
  return new PackStorageEngine();
};
