import type { AppInfrastructure } from '../../../app/context.js';
import {
  createPackEntityOverviewProjectionService,
  type PackEntityProjectionSnapshot
} from './pack_entity_overview_projection_service.js';
import { createPackProjectionScopeAdapter } from './pack_projection_scope_adapter.js';

export {
  createPackEntityOverviewProjectionService,
  type GetPackEntityOverviewProjectionInput,
  type PackEntityOverviewProjectionService,
  type PackEntityProjectionSnapshot
} from './pack_entity_overview_projection_service.js';
export type { PackProjectionMetadataSnapshot } from './pack_projection_metadata_resolver.js';

export const buildPackEntityOverviewProjection = async (
  context: AppInfrastructure,
  input: {
    packId: string;
    pack: {
      id: string;
      name: string;
      version: string;
    };
  }
): Promise<PackEntityProjectionSnapshot> => {
  const service = createPackEntityOverviewProjectionService(context);
  return service.getProjection({
    pack_id: input.packId,
    pack: input.pack
  });
};

export const getPackEntityOverviewProjection = async (
  context: AppInfrastructure,
  packId?: string
): Promise<PackEntityProjectionSnapshot> => {
  const scope = createPackProjectionScopeAdapter(context);
  const resolved = await scope.resolveStablePack(packId ?? '', 'pack entity overview projection');
  const service = createPackEntityOverviewProjectionService(context);
  return service.getProjection(resolved);
};
