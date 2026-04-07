import type { PackRuntimeEntityStateInput, PackRuntimeEntityStateRecord } from '../runtime/core_models.js';
import {
  listSqliteEngineOwnedRecords,
  packRuntimeEntityStateTableSpec,
  upsertSqliteEngineOwnedRecord
} from './internal/sqlite_engine_owned_store.js';
import { resolvePackRuntimeDatabaseLocation } from './pack_db_locator.js';

export const upsertPackEntityState = async (input: PackRuntimeEntityStateInput): Promise<PackRuntimeEntityStateRecord> => {
  const location = resolvePackRuntimeDatabaseLocation(input.pack_id);
  return upsertSqliteEngineOwnedRecord(location.runtimeDbPath, packRuntimeEntityStateTableSpec, {
    id: input.id,
    pack_id: input.pack_id,
    entity_id: input.entity_id,
    state_namespace: input.state_namespace,
    state_json: input.state_json,
    created_at: input.now,
    updated_at: input.now
  });
};

export const listPackEntityStates = async (packId: string): Promise<PackRuntimeEntityStateRecord[]> => {
  const location = resolvePackRuntimeDatabaseLocation(packId);
  return listSqliteEngineOwnedRecords(location.runtimeDbPath, packRuntimeEntityStateTableSpec, packId);
};
