import type { AppInfrastructure } from '../../../app/context.js';
import { ApiError } from '../../../utils/api_error.js';
import type { WorldPack } from '../../manifest/loader.js';

export interface ResolvedPackProjectionTarget {
  activePack: WorldPack | null;
  resolvedPackId: string | null;
}

export const resolvePackProjectionTarget = (
  context: AppInfrastructure,
  input: {
    requestedPackId?: string;
    feature: string;
    allowMissingActivePack?: boolean;
  }
): ResolvedPackProjectionTarget => {
  const activePack = context.activePack.getActivePack() ?? null;
  const requestedPackId = typeof input.requestedPackId === 'string' && input.requestedPackId.trim().length > 0
    ? input.requestedPackId.trim()
    : undefined;

  if (!activePack) {
    if (input.allowMissingActivePack === true && requestedPackId === undefined) {
      return {
        activePack: null,
        resolvedPackId: null
      };
    }

    throw new ApiError(503, 'WORLD_PACK_NOT_READY', `World pack not ready for ${input.feature}`);
  }

  const activePackId = activePack.metadata.id;
  if (requestedPackId && requestedPackId !== activePackId) {
    throw new ApiError(
      409,
      'PACK_ROUTE_ACTIVE_PACK_MISMATCH',
      'Requested pack_id does not match the current active pack',
      {
        requested_pack_id: requestedPackId,
        active_pack_id: activePackId,
        feature: input.feature
      }
    );
  }

  return {
    activePack,
    resolvedPackId: requestedPackId ?? activePackId
  };
};
