import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import { getPackRuntimeLookupPort } from './app_context_ports.js';

const normalizeRequestedPackId = (packId: string): string => {
  const normalizedPackId = packId.trim();
  if (normalizedPackId.length === 0) {
    throw new ApiError(400, 'PACK_ID_INVALID', 'Pack id is required');
  }

  return normalizedPackId;
};

export const createPackScopeResolver = (context: AppContext) => {
  const lookup = getPackRuntimeLookupPort({
    packRuntimeLookup: context.packRuntimeLookup
  });

  return {
    assertPackScope(packId: string, feature: string): string {
      const normalizedPackId = normalizeRequestedPackId(packId);
      if (!lookup.hasPackRuntime(normalizedPackId)) {
        throw new ApiError(404, 'PACK_RUNTIME_NOT_FOUND', `Pack runtime not found for ${feature}`, {
          pack_id: normalizedPackId,
          feature
        });
      }

      return normalizedPackId;
    },

    resolvePackScope(packId: string, feature: string): string {
      const normalizedPackId = normalizeRequestedPackId(packId);
      if (!lookup.hasPackRuntime(normalizedPackId)) {
        throw new ApiError(404, 'PACK_RUNTIME_NOT_FOUND', `Pack runtime not found for ${feature}`, {
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
  feature: string
): string => {
  return createPackScopeResolver(context).assertPackScope(packId, feature);
};
