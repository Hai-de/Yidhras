import type { PackRuntimeScopeMode, PackScopeResolver } from '../../core/pack_runtime_ports.js';
import { resolvePackProjectionTarget } from '../../packs/runtime/projections/active_pack_projection_guard.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import { getPackRuntimeLookupPort } from './app_context_ports.js';

const normalizeRequestedPackId = (packId: string): string => {
  const normalizedPackId = packId.trim();
  if (normalizedPackId.length === 0) {
    throw new ApiError(400, 'EXPERIMENTAL_PACK_ID_INVALID', 'Experimental runtime pack id is required');
  }

  return normalizedPackId;
};

export const createPackScopeResolver = (context: AppContext): PackScopeResolver => {
  return {
    assertPackScope(packId: string, mode: PackRuntimeScopeMode, feature: string): string {
      if (mode === 'stable') {
        const { resolvedPackId } = resolvePackProjectionTarget(context, {
          requestedPackId: packId,
          feature
        });

        if (!resolvedPackId) {
          throw new ApiError(503, 'WORLD_PACK_NOT_READY', `World pack not ready for ${feature}`);
        }

        return resolvedPackId;
      }

      const normalizedPackId = normalizeRequestedPackId(packId);
      const lookup = getPackRuntimeLookupPort({
        packRuntimeLookup: context.packRuntimeLookup,
        sim: context.sim
      });
      if (!lookup.hasPackRuntime(normalizedPackId)) {
        throw new ApiError(404, 'EXPERIMENTAL_PACK_RUNTIME_NOT_FOUND', `Experimental pack runtime not found for ${feature}`, {
          pack_id: normalizedPackId,
          feature
        });
      }

      return normalizedPackId;
    }
  };
};

export const assertPackScope = (
  context: AppContext,
  packId: string,
  mode: PackRuntimeScopeMode,
  feature: string
): string => {
  return createPackScopeResolver(context).assertPackScope(packId, mode, feature);
};
