import type { AppContext } from '../../../app/context.js';
import {
  createPackProjectionMetadataResolver,
  type PackProjectionMetadataResolver,
  type PackProjectionResolution
} from './pack_projection_metadata_resolver.js';

export interface PackProjectionScopeAdapter {
  resolveStablePack(packId: string, feature: string): Promise<PackProjectionResolution>;
  resolveExperimentalPack(packId: string, feature: string): Promise<PackProjectionResolution>;
}

export const createPackProjectionScopeAdapter = (
  context: AppContext,
  resolver: PackProjectionMetadataResolver = createPackProjectionMetadataResolver(context)
): PackProjectionScopeAdapter => {
  return {
    resolveStablePack(packId: string, feature: string): Promise<PackProjectionResolution> {
      return resolver.resolve(packId, 'stable', feature);
    },
    resolveExperimentalPack(packId: string, feature: string): Promise<PackProjectionResolution> {
      return resolver.resolve(packId, 'experimental', feature);
    }
  };
};
