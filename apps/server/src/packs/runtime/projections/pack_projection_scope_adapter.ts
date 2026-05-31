import type { DataContext, PortContext, RuntimeContext } from '../../../app/context.js';
import { createPackProjectionMetadataResolver } from './pack_projection_metadata_resolver.js';
import type {
  PackProjectionMetadataResolver,
  PackProjectionResolution
} from './pack_projection_metadata_types.js';

export interface PackProjectionScopeAdapter {
  resolveStablePack(packId: string, feature: string): Promise<PackProjectionResolution>;
  resolveExperimentalPack(packId: string, feature: string): Promise<PackProjectionResolution>;
}

export const createPackProjectionScopeAdapter = (
  context: DataContext & PortContext & RuntimeContext,
  resolver: PackProjectionMetadataResolver = createPackProjectionMetadataResolver(context)
): PackProjectionScopeAdapter => {
  return {
    resolveStablePack(packId: string, feature: string): Promise<PackProjectionResolution> {
      return resolver.resolve(packId, feature);
    },
    resolveExperimentalPack(packId: string, feature: string): Promise<PackProjectionResolution> {
      return resolver.resolve(packId, feature);
    }
  };
};
