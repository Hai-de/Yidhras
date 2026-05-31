import { listPackNarrativeTimelineProjection } from '../../packs/runtime/projections/narrative_projection_service.js';
import type { DataContext, PortContext, RuntimeContext } from '../context.js';

export const getPackNarrativeTimelineProjection = async (
  context: DataContext & PortContext & RuntimeContext,
  packId?: string
) => listPackNarrativeTimelineProjection(context, packId);
