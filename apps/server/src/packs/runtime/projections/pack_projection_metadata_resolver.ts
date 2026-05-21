import type { AppContext, AppInfrastructure } from '../../../app/context.js';
import { assertPackScope } from '../../../app/services/pack/pack_scope_resolver.js';
import { ApiError } from '../../../utils/api_error.js';
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

const toPackProjectionMetadataSnapshot = (pack: WorldPack): PackProjectionMetadataSnapshot => ({
  id: pack.metadata.id,
  name: pack.metadata.name,
  version: pack.metadata.version
});

export const createPackProjectionMetadataResolver = (
  context: AppInfrastructure
): PackProjectionMetadataResolver => {
  const ctx = context as unknown as AppContext;
  return {
    resolve(packId: string, feature: string): Promise<PackProjectionResolution> {
      const resolvedPackId = assertPackScope(ctx, packId, feature);
      const handle = ctx.getPackRuntimeHandle?.(resolvedPackId);
      if (!handle) {
        return Promise.reject(new ApiError(503, 'WORLD_PACK_NOT_READY', `World pack not ready for ${feature}`, {
          pack_id: resolvedPackId,
          feature
        }));
      }

      return Promise.resolve({
        pack_id: resolvedPackId,
        pack: toPackProjectionMetadataSnapshot(handle.pack)
      });
    }
  };
};
