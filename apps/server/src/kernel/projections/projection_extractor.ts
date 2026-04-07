import type { AppContext } from '../../app/context.js';
import { getPackEntityOverviewProjection } from '../../packs/runtime/projections/entity_overview_service.js';
import { listPackNarrativeTimelineProjection } from '../../packs/runtime/projections/narrative_projection_service.js';
import { getOperatorOverviewProjection } from './operator_overview_service.js';

export interface GlobalProjectionIndexSnapshot {
  generated_at: string;
  runtime: Awaited<ReturnType<typeof getOperatorOverviewProjection>>['runtime'];
  pack: {
    entity_summary: Awaited<ReturnType<typeof getPackEntityOverviewProjection>>['summary'];
    timeline_count: number;
  } | null;
}

export const extractGlobalProjectionIndex = async (context: AppContext): Promise<GlobalProjectionIndexSnapshot> => {
  const operatorProjection = await getOperatorOverviewProjection(context);
  const activePack = context.sim.getActivePack();

  if (!activePack) {
    return {
      generated_at: context.sim.getCurrentTick().toString(),
      runtime: operatorProjection.runtime,
      pack: null
    };
  }

  const [entityProjection, narrativeProjection] = await Promise.all([
    getPackEntityOverviewProjection(context, activePack.metadata.id),
    listPackNarrativeTimelineProjection(context, activePack.metadata.id)
  ]);

  return {
    generated_at: context.sim.getCurrentTick().toString(),
    runtime: operatorProjection.runtime,
    pack: {
      entity_summary: entityProjection.summary,
      timeline_count: narrativeProjection.timeline.length
    }
  };
};
