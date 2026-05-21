import { createPackEntityOverviewProjectionService } from '../../packs/runtime/projections/pack_entity_overview_projection_service.js';
import { createPackNarrativeProjectionService } from '../../packs/runtime/projections/pack_narrative_projection_service.js';
import { createPackProjectionScopeAdapter } from '../../packs/runtime/projections/pack_projection_scope_adapter.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import { getPackOverviewProjectionSummary } from './overview.js';
import { listPackPluginInstallations } from './plugins.js';

const requireExperimentalPackResolution = async (context: AppContext, packId: string, feature: string) => {
  const scope = createPackProjectionScopeAdapter(context);
  return scope.resolveExperimentalPack(packId, feature);
};

export const getExperimentalPackEntityProjection = async (
  context: AppContext,
  packId: string
) => {
  const resolved = await requireExperimentalPackResolution(context, packId, 'experimental pack entity projection');
  const service = createPackEntityOverviewProjectionService(context);
  return service.getProjection(resolved);
};

export const getExperimentalPackAgentOverview = async (
  context: AppContext,
  packId: string,
  entityId: string
) => {
  const projection = await getExperimentalPackEntityProjection(context, packId);
  const packEntity = projection.entities.find(entity => entity.id === entityId) ?? null;
  return {
    pack_id: projection.pack.id,
    entity_id: entityId,
    pack_projection: {
      entity: packEntity
        ? {
            entity_kind: packEntity.entity_kind,
            entity_type: packEntity.entity_type ?? null,
            tags: packEntity.tags,
            state: packEntity.state
          }
        : null,
      recent_rule_executions: projection.recent_rule_executions
        .filter(record => record.subject_entity_id === entityId || record.target_entity_id === entityId)
    }
  };
};

export const getExperimentalPackOverviewProjection = async (
  context: AppContext,
  packId: string
) => {
  await requireExperimentalPackResolution(context, packId, 'experimental pack overview projection');
  return getPackOverviewProjectionSummary(context, packId);
};

export const getExperimentalPackNarrativeProjection = async (
  context: AppContext,
  packId: string
) => {
  const resolved = await requireExperimentalPackResolution(context, packId, 'experimental pack narrative projection');
  const service = createPackNarrativeProjectionService(context);
  return service.getProjection(resolved);
};

export const getExperimentalPackPluginInstallations = async (
  context: AppContext,
  packId: string
) => {
  await requireExperimentalPackResolution(context, packId, 'experimental pack plugins projection');
  return listPackPluginInstallations(context, packId);
};

export const translateMissingExperimentalPack = (packId: string, source: string): never => {
  throw new ApiError(404, 'EXPERIMENTAL_PACK_RUNTIME_NOT_FOUND', 'Experimental runtime pack not found', {
    pack_id: packId,
    source
  });
};
