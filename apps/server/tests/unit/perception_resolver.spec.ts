import { describe, expect, it } from 'vitest';

import { createSpatialProximityResolver } from '../../src/perception/index.js';
import type { SpatialRuntime } from '../../src/packs/runtime/spatial_runtime.js';

const createMockSpatialRuntime = (
  locations: Record<string, string>
): SpatialRuntime => {
  const locationMap = new Map(Object.entries(locations));
  return {
    model: 'discrete',
    async getLocation(entityId: string) {
      return locationMap.get(entityId) ?? null;
    },
    neighbors(_locationId: string) {
      return [];
    },
    distance(_a: string, _b: string) {
      return null;
    },
    async moveEntity(_entityId: string, _targetLocation: string, _now: bigint) {
      // noop
    }
  };
};

describe('PerceptionResolver (default spatial_proximity)', () => {
  const resolver = createSpatialProximityResolver();

  it('returns full for global events (no location_id)', async () => {
    const sr = createMockSpatialRuntime({});
    const result = await resolver.resolve(
      { eventId: 'e1', eventTitle: 't', eventDescription: 'd', locationId: null, visibility: null, eventActorEntityId: null },
      'actor-1',
      sr
    );
    expect(result.level).toBe('full');
  });

  it('returns full when observer is at same location (public)', async () => {
    const sr = createMockSpatialRuntime({ 'actor-1': 'kitchen' });
    const result = await resolver.resolve(
      { eventId: 'e1', eventTitle: 't', eventDescription: 'd', locationId: 'kitchen', visibility: 'public', eventActorEntityId: 'actor-2' },
      'actor-1',
      sr
    );
    expect(result.level).toBe('full');
  });

  it('returns none when observer is at different location', async () => {
    const sr = createMockSpatialRuntime({ 'actor-1': 'library' });
    const result = await resolver.resolve(
      { eventId: 'e1', eventTitle: 't', eventDescription: 'd', locationId: 'kitchen', visibility: 'public', eventActorEntityId: 'actor-2' },
      'actor-1',
      sr
    );
    expect(result.level).toBe('none');
  });

  it('returns full for private event when observer IS the event actor', async () => {
    const sr = createMockSpatialRuntime({ 'actor-1': 'kitchen' });
    const result = await resolver.resolve(
      { eventId: 'e1', eventTitle: 't', eventDescription: 'd', locationId: 'kitchen', visibility: 'private', eventActorEntityId: 'actor-1' },
      'actor-1',
      sr
    );
    expect(result.level).toBe('full');
  });

  it('returns none for private event when observer is NOT the event actor (same location)', async () => {
    const sr = createMockSpatialRuntime({ 'actor-1': 'kitchen' });
    const result = await resolver.resolve(
      { eventId: 'e1', eventTitle: 't', eventDescription: 'd', locationId: 'kitchen', visibility: 'private', eventActorEntityId: 'actor-2' },
      'actor-1',
      sr
    );
    expect(result.level).toBe('none');
  });

  it('returns none when observer has no spatial state', async () => {
    const sr = createMockSpatialRuntime({});
    const result = await resolver.resolve(
      { eventId: 'e1', eventTitle: 't', eventDescription: 'd', locationId: 'kitchen', visibility: 'public', eventActorEntityId: null },
      'actor-1',
      sr
    );
    expect(result.level).toBe('none');
  });
});
