import type { PackRuntimeMediatorBindingInput, PackRuntimeMediatorBindingRecord } from '../runtime/core_models.js';
import type { PackStorageAdapter } from './PackStorageAdapter.js';

export const upsertPackMediatorBinding = async (
  adapter: PackStorageAdapter,
  input: PackRuntimeMediatorBindingInput
): Promise<PackRuntimeMediatorBindingRecord> => {
  return adapter.upsertEngineOwnedRecord<PackRuntimeMediatorBindingRecord>(input.pack_id, 'mediator_bindings', {
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

export const listPackMediatorBindings = async (
  adapter: PackStorageAdapter,
  packId: string
): Promise<PackRuntimeMediatorBindingRecord[]> => {
  return adapter.listEngineOwnedRecords<PackRuntimeMediatorBindingRecord>(packId, 'mediator_bindings');
};
