import type { PackRuntimeMediatorBindingInput, PackRuntimeMediatorBindingRecord } from '../runtime/core_models.js';
import {
  listSqliteEngineOwnedRecords,
  packRuntimeMediatorBindingTableSpec,
  upsertSqliteEngineOwnedRecord
} from './internal/sqlite_engine_owned_store.js';
import { resolvePackRuntimeDatabaseLocation } from './pack_db_locator.js';

export const upsertPackMediatorBinding = async (
  input: PackRuntimeMediatorBindingInput
): Promise<PackRuntimeMediatorBindingRecord> => {
  const location = resolvePackRuntimeDatabaseLocation(input.pack_id);
  return upsertSqliteEngineOwnedRecord(location.runtimeDbPath, packRuntimeMediatorBindingTableSpec, {
    id: input.id,
    pack_id: input.pack_id,
    mediator_id: input.mediator_id,
    subject_entity_id: input.subject_entity_id ?? null,
    binding_kind: input.binding_kind,
    status: input.status,
    metadata_json: input.metadata_json ?? null,
    created_at: input.now,
    updated_at: input.now
  });
};

export const listPackMediatorBindings = async (packId: string): Promise<PackRuntimeMediatorBindingRecord[]> => {
  const location = resolvePackRuntimeDatabaseLocation(packId);
  return listSqliteEngineOwnedRecords(location.runtimeDbPath, packRuntimeMediatorBindingTableSpec, packId);
};
