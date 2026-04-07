import type { AppContext } from '../context.js';

import { listPackNarrativeTimelineProjection } from '../../packs/runtime/projections/narrative_projection_service.js';

export const getPackNarrativeTimelineProjection = async (
  context: AppContext,
  packId?: string
) => listPackNarrativeTimelineProjection(context, packId);
