import type { PackRuntimeWorldEntityInput, PackRuntimeWorldEntityRecord } from '../runtime/core_models.js';
import {
  listSqliteEngineOwnedRecords,
  packRuntimeWorldEntityTableSpec,
  upsertSqliteEngineOwnedRecord
} from './internal/sqlite_engine_owned_store.js';
import { resolvePackRuntimeDatabaseLocation } from './pack_db_locator.js';

export const upsertPackWorldEntity = async (input: PackRuntimeWorldEntityInput): Promise<PackRuntimeWorldEntityRecord> => {
  const location = resolvePackRuntimeDatabaseLocation(input.pack_id);
  return upsertSqliteEngineOwnedRecord(location.runtimeDbPath, packRuntimeWorldEntityTableSpec, {
    id: input.id,
    pack_id: input.pack_id,
    entity_kind: input.entity_kind,
    entity_type: input.entity_type ?? null,
    label: input.label,
    tags: input.tags ?? [],
    static_schema_ref: input.static_schema_ref ?? null,
    payload_json: input.payload_json ?? null,
    created_at: input.now,
    updated_at: input.now
  });
};

export const listPackWorldEntities = async (packId: string): Promise<PackRuntimeWorldEntityRecord[]> => {
  const location = resolvePackRuntimeDatabaseLocation(packId);
  return listSqliteEngineOwnedRecords(location.runtimeDbPath, packRuntimeWorldEntityTableSpec, packId);
};
