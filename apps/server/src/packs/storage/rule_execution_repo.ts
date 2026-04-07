import type { PackRuntimeRuleExecutionInput, PackRuntimeRuleExecutionRecord } from '../runtime/core_models.js';
import {
  listSqliteEngineOwnedRecords,
  packRuntimeRuleExecutionTableSpec,
  upsertSqliteEngineOwnedRecord
} from './internal/sqlite_engine_owned_store.js';
import { resolvePackRuntimeDatabaseLocation } from './pack_db_locator.js';

export const recordPackRuleExecution = async (
  input: PackRuntimeRuleExecutionInput
): Promise<PackRuntimeRuleExecutionRecord> => {
  const location = resolvePackRuntimeDatabaseLocation(input.pack_id);
  return upsertSqliteEngineOwnedRecord(location.runtimeDbPath, packRuntimeRuleExecutionTableSpec, {
    id: input.id,
    pack_id: input.pack_id,
    rule_id: input.rule_id,
    capability_key: input.capability_key ?? null,
    mediator_id: input.mediator_id ?? null,
    subject_entity_id: input.subject_entity_id ?? null,
    target_entity_id: input.target_entity_id ?? null,
    execution_status: input.execution_status,
    payload_json: input.payload_json ?? null,
    emitted_events_json: input.emitted_events_json ?? [],
    created_at: input.now,
    updated_at: input.now
  });
};

export const listPackRuleExecutionRecords = async (packId: string): Promise<PackRuntimeRuleExecutionRecord[]> => {
  const location = resolvePackRuntimeDatabaseLocation(packId);
  return listSqliteEngineOwnedRecords(location.runtimeDbPath, packRuntimeRuleExecutionTableSpec, packId);
};
