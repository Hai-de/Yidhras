import fs from 'fs';

import type { PackCollectionRecord } from '../pack_collection_repo.js';
import {
  ensureDeclaredPackCollectionTables,
  listDeclaredPackCollectionRecords,
  upsertDeclaredPackCollectionRecord
} from '../pack_collection_repo.js';
import { resolvePackRuntimeDatabaseLocation } from '../pack_db_locator.js';
import type {
  CollectionDefinition,
  PackStorageAdapter,
  PackStorageBackend
} from '../PackStorageAdapter.js';
import type { PersistedStoragePlan } from './plan_store.js';
import { readPersistedStoragePlan } from './plan_store.js';
import {
  ENGINE_OWNED_TABLE_NAMES,
  ensurePackRuntimeSqliteStorage,
  listSqliteEngineOwnedRecords,
  packRuntimeAuthorityGrantTableSpec,
  packRuntimeEntityStateTableSpec,
  packRuntimeMediatorBindingTableSpec,
  packRuntimeRuleExecutionTableSpec,
  packRuntimeWorldEntityTableSpec,
  type SqliteEngineOwnedTableSpec,
  upsertSqliteEngineOwnedRecord} from './sqlite_engine_owned_store.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TABLE_SPEC_MAP: Record<string, SqliteEngineOwnedTableSpec<any>> = {
  world_entities: packRuntimeWorldEntityTableSpec,
  entity_states: packRuntimeEntityStateTableSpec,
  authority_grants: packRuntimeAuthorityGrantTableSpec,
  mediator_bindings: packRuntimeMediatorBindingTableSpec,
  rule_execution_records: packRuntimeRuleExecutionTableSpec
};

export class SqlitePackStorageAdapter implements PackStorageAdapter {
  readonly backend: PackStorageBackend = 'sqlite';

  private resolveDbPath(packId: string): string {
    return resolvePackRuntimeDatabaseLocation(packId).runtimeDbPath;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolveSpec(tableName: string): SqliteEngineOwnedTableSpec<any> {
    const spec = TABLE_SPEC_MAP[tableName];
    if (!spec) {
      throw new Error(`[SqlitePackStorageAdapter] unknown engine-owned table: ${tableName}`);
    }
    return spec;
  }

  private readPersistedPlan(packId: string): PersistedStoragePlan | null {
    const dbPath = this.resolveDbPath(packId);
    return readPersistedStoragePlan(`${dbPath}.storage-plan.json`);
  }

  // -- Schema --

  async ensureEngineOwnedSchema(packId: string): Promise<void> {
    const dbPath = this.resolveDbPath(packId);
    const dir = dbPath.substring(0, dbPath.lastIndexOf('/'));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(dbPath)) {
      fs.writeFileSync(dbPath, '');
    }
    await ensurePackRuntimeSqliteStorage(dbPath);
  }

  async ensureCollection(packId: string, _collection: CollectionDefinition): Promise<void> {
    const plan = this.readPersistedPlan(packId);
    if (!plan) {
      return;
    }
    const collection = plan.pack_collections.find(c => c.key === _collection.key);
    if (!collection) {
      return;
    }
    const dbPath = this.resolveDbPath(packId);
    await ensureDeclaredPackCollectionTables(dbPath, [collection]);
  }

  // -- Engine-owned records --

  async listEngineOwnedRecords<T = Record<string, unknown>>(packId: string, tableName: string): Promise<T[]> {
    const spec = this.resolveSpec(tableName);
    const dbPath = this.resolveDbPath(packId);
    return listSqliteEngineOwnedRecords(dbPath, spec, packId) as Promise<T[]>;
  }

  async upsertEngineOwnedRecord<T = Record<string, unknown>>(packId: string, tableName: string, record: T): Promise<T> {
    const spec = this.resolveSpec(tableName);
    const dbPath = this.resolveDbPath(packId);
    if (!fs.existsSync(dbPath)) {
      throw new Error(`[SqlitePackStorageAdapter] runtime db does not exist for pack=${packId}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return upsertSqliteEngineOwnedRecord(dbPath, spec, record as any) as Promise<T>;
  }

  // -- Dynamic collections --

  async upsertCollectionRecord(packId: string, collectionKey: string, record: PackCollectionRecord): Promise<PackCollectionRecord | null> {
    return upsertDeclaredPackCollectionRecord(packId, collectionKey, record);
  }

  async listCollectionRecords(packId: string, collectionKey: string): Promise<PackCollectionRecord[]> {
    return listDeclaredPackCollectionRecords(packId, collectionKey);
  }

  // -- Lifecycle --

  async destroyPackStorage(packId: string): Promise<void> {
    const dbPath = this.resolveDbPath(packId);
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  }

  // -- Snapshot support --

  async exportPackData(packId: string): Promise<Record<string, unknown[]>> {
    const result: Record<string, unknown[]> = {};

    for (const tableName of ENGINE_OWNED_TABLE_NAMES) {
      if (tableName === 'projection_events') {
        continue;
      }
      result[tableName] = await this.listEngineOwnedRecords(packId, tableName);
    }

    const plan = this.readPersistedPlan(packId);
    if (plan) {
      for (const collection of plan.pack_collections) {
        result[collection.key] = await this.listCollectionRecords(packId, collection.key);
      }
    }

    return result;
  }

  async importPackData(packId: string, data: Record<string, unknown[]>): Promise<void> {
    await this.ensureEngineOwnedSchema(packId);

    for (const [tableName, rows] of Object.entries(data)) {
      if (ENGINE_OWNED_TABLE_NAMES.includes(tableName as typeof ENGINE_OWNED_TABLE_NAMES[number]) && tableName !== 'projection_events') {
        for (const row of rows) {
          await this.upsertEngineOwnedRecord(packId, tableName, row);
        }
      } else {
        for (const row of rows) {
          await this.upsertCollectionRecord(packId, tableName, row as PackCollectionRecord);
        }
      }
    }
  }

  // -- Health --

  async ping(packId: string): Promise<boolean> {
    const dbPath = this.resolveDbPath(packId);
    return fs.existsSync(dbPath);
  }
}
