import type { PackRuntimeAuthorityGrantInput, PackRuntimeAuthorityGrantRecord } from '../runtime/core_models.js';
import {
  listSqliteEngineOwnedRecords,
  packRuntimeAuthorityGrantTableSpec,
  upsertSqliteEngineOwnedRecord
} from './internal/sqlite_engine_owned_store.js';
import { resolvePackRuntimeDatabaseLocation } from './pack_db_locator.js';

export const upsertPackAuthorityGrant = async (
  input: PackRuntimeAuthorityGrantInput
): Promise<PackRuntimeAuthorityGrantRecord> => {
  const location = resolvePackRuntimeDatabaseLocation(input.pack_id);
  return upsertSqliteEngineOwnedRecord(location.runtimeDbPath, packRuntimeAuthorityGrantTableSpec, {
    id: input.id,
    pack_id: input.pack_id,
    source_entity_id: input.source_entity_id,
    target_selector_json: input.target_selector_json,
    capability_key: input.capability_key,
    grant_type: input.grant_type,
    mediated_by_entity_id: input.mediated_by_entity_id ?? null,
    scope_json: input.scope_json ?? null,
    conditions_json: input.conditions_json ?? null,
    priority: input.priority ?? 0,
    status: input.status ?? null,
    revocable: input.revocable ?? null,
    created_at: input.now,
    updated_at: input.now
  });
};

export const listPackAuthorityGrants = async (packId: string): Promise<PackRuntimeAuthorityGrantRecord[]> => {
  const location = resolvePackRuntimeDatabaseLocation(packId);
  return listSqliteEngineOwnedRecords(location.runtimeDbPath, packRuntimeAuthorityGrantTableSpec, packId);
};
