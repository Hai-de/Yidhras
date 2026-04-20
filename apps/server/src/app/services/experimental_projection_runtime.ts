import { buildPackEntityOverviewProjection } from '../../packs/runtime/projections/entity_overview_service.js';
import type { AppContext } from '../context.js';
import { getPackNarrativeTimelineProjection } from './narrative.js';
import { getPackOverviewProjectionSummary } from './overview.js';
import { listPackPluginInstallations } from './plugins.js';

const requireExperimentalPackHandle = (context: AppContext, packId: string) => {
  const handle = context.sim.getPackRuntimeHandle(packId);
  if (!handle) {
    throw new Error(`experimental runtime pack not found: ${packId}`);
  }

  return handle;
};

const assertExperimentalPackLoaded = (context: AppContext, packId: string): void => {
  requireExperimentalPackHandle(context, packId);
};

export const getExperimentalPackEntityProjection = async (
  context: AppContext,
  packId: string
) => {
  const handle = requireExperimentalPackHandle(context, packId);
  return buildPackEntityOverviewProjection(context, {
    packId: handle.pack_id,
    pack: {
      id: handle.pack.metadata.id,
      name: handle.pack.metadata.name,
      version: handle.pack.metadata.version
    }
  });
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
  assertExperimentalPackLoaded(context, packId);
  return getPackOverviewProjectionSummary(context, packId);
};

export const getExperimentalPackNarrativeProjection = async (
  context: AppContext,
  packId: string
) => {
  assertExperimentalPackLoaded(context, packId);
  return getPackNarrativeTimelineProjection(context, packId);
};

export const getExperimentalPackPluginInstallations = async (
  context: AppContext,
  packId: string
) => {
  assertExperimentalPackLoaded(context, packId);
  return listPackPluginInstallations(context, packId);
};
