import type { PackRuntimeWorldEntityInput, PackRuntimeWorldEntityRecord } from '../runtime/core_models.js';
import type { PackStorageAdapter } from './PackStorageAdapter.js';

export const upsertPackWorldEntity = async (
  adapter: PackStorageAdapter,
  input: PackRuntimeWorldEntityInput
): Promise<PackRuntimeWorldEntityRecord> => {
  return adapter.upsertEngineOwnedRecord<PackRuntimeWorldEntityRecord>(input.pack_id, 'world_entities', {
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

export const listPackWorldEntities = async (
  adapter: PackStorageAdapter,
  packId: string
): Promise<PackRuntimeWorldEntityRecord[]> => {
  return adapter.listEngineOwnedRecords<PackRuntimeWorldEntityRecord>(packId, 'world_entities');
};
