import { ApiError } from '../../../utils/api_error.js';
import { toPackProjectionMetadataSnapshot } from './pack_projection_metadata_types.js';

export type {
  PackProjectionMetadataResolver,
  PackProjectionMetadataSnapshot,
  PackProjectionResolution
} from './pack_projection_metadata_types.js';

/** Inlined pack-scope assertion — avoids cycle with app/services/pack/pack_scope_resolver. */
const assertPackRuntime = (packRuntimeLookup: unknown, packId: string, feature: string): string => {
  const normalized = packId.trim();
  const lookup = packRuntimeLookup as { hasPackRuntime?: (id: string) => boolean } | null | undefined;
  if (!lookup?.hasPackRuntime?.(normalized)) {
    throw new ApiError(404, 'PACK_RUNTIME_NOT_FOUND', `Pack runtime not found for ${feature}`, {
      pack_id: normalized,
      feature
    });
  }
  return normalized;
};

export const createPackProjectionMetadataResolver = (
  context: import('../../../app/context.js').DataContext &
    import('../../../app/context.js').PortContext &
    import('../../../app/context.js').RuntimeContext
): import('./pack_projection_metadata_types.js').PackProjectionMetadataResolver => {
  return {
    resolve(packId: string, feature: string): Promise<import('./pack_projection_metadata_types.js').PackProjectionResolution> {
      const resolvedPackId = assertPackRuntime(context.packRuntimeLookup, packId, feature);
      const handle = context.getPackRuntimeHandle?.(resolvedPackId);
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
