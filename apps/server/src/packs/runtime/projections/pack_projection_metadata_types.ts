import type { WorldPack } from '../../manifest/loader.js';

export interface PackProjectionMetadataSnapshot {
  id: string;
  name: string;
  version: string;
}

export interface PackProjectionResolution {
  pack_id: string;
  pack: PackProjectionMetadataSnapshot;
}

export interface PackProjectionMetadataResolver {
  resolve(packId: string, feature: string): Promise<PackProjectionResolution>;
}

export const toPackProjectionMetadataSnapshot = (pack: WorldPack): PackProjectionMetadataSnapshot => ({
  id: pack.metadata.id,
  name: pack.metadata.name,
  version: pack.metadata.version
});
