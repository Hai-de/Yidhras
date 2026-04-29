import type { PackRuntimeAuthorityGrantInput, PackRuntimeAuthorityGrantRecord } from '../runtime/core_models.js';
import type { PackStorageAdapter } from './PackStorageAdapter.js';

export const upsertPackAuthorityGrant = async (
  adapter: PackStorageAdapter,
  input: PackRuntimeAuthorityGrantInput
): Promise<PackRuntimeAuthorityGrantRecord> => {
  return adapter.upsertEngineOwnedRecord<PackRuntimeAuthorityGrantRecord>(input.pack_id, 'authority_grants', {
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

export const listPackAuthorityGrants = async (
  adapter: PackStorageAdapter,
  packId: string
): Promise<PackRuntimeAuthorityGrantRecord[]> => {
  return adapter.listEngineOwnedRecords<PackRuntimeAuthorityGrantRecord>(packId, 'authority_grants');
};
