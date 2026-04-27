import type { AppInfrastructure } from '../../../app/context.js';
import {
  createPackNarrativeProjectionService,
  type PackNarrativeProjectionSnapshot
} from './pack_narrative_projection_service.js';
import { createPackProjectionScopeAdapter } from './pack_projection_scope_adapter.js';

export {
  createPackNarrativeProjectionService,
  type GetPackNarrativeProjectionInput,
  type PackNarrativeProjectionService,
  type PackNarrativeProjectionSnapshot
} from './pack_narrative_projection_service.js';

export const listPackNarrativeTimelineProjection = async (
  context: AppInfrastructure,
  packId?: string
): Promise<PackNarrativeProjectionSnapshot> => {
  const scope = createPackProjectionScopeAdapter(context);
  const resolved = await scope.resolveStablePack(packId ?? '', 'pack narrative timeline projection');
  const service = createPackNarrativeProjectionService(context);
  return service.getProjection(resolved);
};
