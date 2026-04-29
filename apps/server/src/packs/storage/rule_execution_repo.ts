import type { PackRuntimeRuleExecutionInput, PackRuntimeRuleExecutionRecord } from '../runtime/core_models.js';
import type { PackStorageAdapter } from './PackStorageAdapter.js';

export const recordPackRuleExecution = async (
  adapter: PackStorageAdapter,
  input: PackRuntimeRuleExecutionInput
): Promise<PackRuntimeRuleExecutionRecord> => {
  return adapter.upsertEngineOwnedRecord<PackRuntimeRuleExecutionRecord>(input.pack_id, 'rule_execution_records', {
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

export const listPackRuleExecutionRecords = async (
  adapter: PackStorageAdapter,
  packId: string
): Promise<PackRuntimeRuleExecutionRecord[]> => {
  return adapter.listEngineOwnedRecords<PackRuntimeRuleExecutionRecord>(packId, 'rule_execution_records');
};
