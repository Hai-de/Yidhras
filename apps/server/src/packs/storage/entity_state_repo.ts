import type { PackRuntimeEntityStateInput, PackRuntimeEntityStateRecord } from '../runtime/core_models.js';
import type { PackStorageAdapter } from './PackStorageAdapter.js';

export const upsertPackEntityState = async (
  adapter: PackStorageAdapter,
  input: PackRuntimeEntityStateInput
): Promise<PackRuntimeEntityStateRecord> => {
  return adapter.upsertEngineOwnedRecord<PackRuntimeEntityStateRecord>(input.pack_id, 'entity_states', {
    id: input.id,
    pack_id: input.pack_id,
    entity_id: input.entity_id,
    state_namespace: input.state_namespace,
    state_json: input.state_json,
    created_at: input.now,
    updated_at: input.now
  });
};

export const listPackEntityStates = async (
  adapter: PackStorageAdapter,
  packId: string
): Promise<PackRuntimeEntityStateRecord[]> => {
  return adapter.listEngineOwnedRecords<PackRuntimeEntityStateRecord>(packId, 'entity_states');
};
