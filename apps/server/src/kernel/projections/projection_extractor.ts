import type { AppInfrastructure } from '../../app/context.js';
import { readVisibleClockSnapshot } from '../../app/services/app_context_ports.js';
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

export const extractGlobalProjectionIndex = async (context: AppInfrastructure): Promise<GlobalProjectionIndexSnapshot> => {
  const operatorProjection = await getOperatorOverviewProjection(context);
  const activePack = context.activePack.getActivePack();
  const visibleClock = readVisibleClockSnapshot(context as unknown as Parameters<typeof readVisibleClockSnapshot>[0]);

  /**
   * generated_at is an operator-visible/read-model timestamp and therefore
   * should prefer the host-visible clock truth rather than reaching directly
   * into raw simulation state.
   */

  if (!activePack) {
    return {
      generated_at: visibleClock.absolute_ticks,
      runtime: operatorProjection.runtime,
      pack: null
    };
  }

  const [entityProjection, narrativeProjection] = await Promise.all([
    getPackEntityOverviewProjection(context, activePack.metadata.id),
    listPackNarrativeTimelineProjection(context, activePack.metadata.id)
  ]);

  return {
    generated_at: visibleClock.absolute_ticks,
    runtime: operatorProjection.runtime,
    pack: {
      entity_summary: entityProjection.summary,
      timeline_count: narrativeProjection.timeline.length
    }
  };
};
