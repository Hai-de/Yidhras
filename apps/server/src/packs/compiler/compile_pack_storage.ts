import type { WorldPack } from '../schema/constitution_schema.js';
import type { WorldPackStorage } from '../schema/storage_schema.js';

export interface CompiledPackStoragePlan {
  packId: string;
  runtimeDbFile: string;
  strategy: WorldPackStorage['strategy'];
  engineOwnedCollections: string[];
  packCollections: WorldPackStorage['pack_collections'];
  projections: WorldPackStorage['projections'];
  installPolicy: WorldPackStorage['install'];
}

const DEFAULT_ENGINE_OWNED_COLLECTIONS = [
  'world_entities',
  'entity_states',
  'authority_grants',
  'mediator_bindings',
  'rule_execution_records',
  'projection_events'
] as const;

export const compilePackStoragePlan = (pack: WorldPack): CompiledPackStoragePlan => {
  const storage = pack.storage ?? {
    strategy: 'isolated_pack_db',
    runtime_db_file: 'runtime.sqlite',
    engine_owned_collections: [...DEFAULT_ENGINE_OWNED_COLLECTIONS],
    pack_collections: [],
    projections: [],
    install: {}
  };

  const engineOwnedCollections = Array.from(
    new Set([...DEFAULT_ENGINE_OWNED_COLLECTIONS, ...storage.engine_owned_collections])
  );

  return {
    packId: pack.metadata.id,
    runtimeDbFile: storage.runtime_db_file,
    strategy: storage.strategy,
    engineOwnedCollections,
    packCollections: [...storage.pack_collections],
    projections: [...storage.projections],
    installPolicy: { ...storage.install }
  };
};
