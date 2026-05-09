import type { PerceptionResolver, PerceptionResult, ResolvePerceptionInput } from './types.js';

/**
 * Default spatial_proximity perception resolver (A layer).
 *
 * - Public event, same location → full
 * - Private event, observer IS the event actor → full
 * - Private event, observer is NOT the event actor → none
 * - Event with no location_id → full (global event, backward compatible)
 * - Same location but different visibility → none
 */
export const createSpatialProximityResolver = (): PerceptionResolver => ({
  async resolve(event: ResolvePerceptionInput, observerEntityId: string, spatialRuntime) {
    if (!event.locationId) {
      return { level: 'full' };
    }

    const observerLocation = await spatialRuntime.getLocation(observerEntityId);

    if (observerLocation !== event.locationId) {
      return { level: 'none' };
    }

    if (event.visibility === 'private' && event.eventActorEntityId !== observerEntityId) {
      return { level: 'none' };
    }

    return { level: 'full' };
  }
});
