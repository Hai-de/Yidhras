import type { AppContext } from '../../../app/context.js';
import { assertPackScope } from '../../../app/services/pack_scope_resolver.js';
import { ApiError } from '../../../utils/api_error.js';
import type { WorldPack } from '../../manifest/loader.js';

export type PackProjectionScopeMode = 'stable' | 'experimental';

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
  resolve(packId: string, mode: PackProjectionScopeMode, feature: string): Promise<PackProjectionResolution>;
}

const toPackProjectionMetadataSnapshot = (pack: WorldPack): PackProjectionMetadataSnapshot => ({
  id: pack.metadata.id,
  name: pack.metadata.name,
  version: pack.metadata.version
});

export const createPackProjectionMetadataResolver = (
  context: AppContext
): PackProjectionMetadataResolver => {
  return {
    async resolve(packId: string, mode: PackProjectionScopeMode, feature: string): Promise<PackProjectionResolution> {
      const resolvedPackId = assertPackScope(context, packId, mode, feature);

      if (mode === 'stable') {
        const activePack = context.sim.getActivePack();
        if (!activePack || activePack.metadata.id !== resolvedPackId) {
          throw new ApiError(503, 'WORLD_PACK_NOT_READY', `World pack not ready for ${feature}`, {
            pack_id: resolvedPackId,
            feature
          });
        }

        return {
          pack_id: resolvedPackId,
          pack: toPackProjectionMetadataSnapshot(activePack)
        };
      }

      const handle = context.sim.getPackRuntimeHandle(resolvedPackId);
      if (!handle) {
        throw new ApiError(404, 'EXPERIMENTAL_PACK_RUNTIME_NOT_FOUND', `Experimental pack runtime not found for ${feature}`, {
          pack_id: resolvedPackId,
          feature
        });
      }

      return {
        pack_id: resolvedPackId,
        pack: toPackProjectionMetadataSnapshot(handle.pack)
      };
    }
  };
};
