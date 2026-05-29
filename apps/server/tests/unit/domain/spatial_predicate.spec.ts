import { describe, expect, it } from 'vitest';

import { spatialPredicateMatches } from '../../../src/domain/rule/enforcement_engine.js';
import type { SpatialRuntime } from '../../../src/packs/runtime/spatial_runtime.js';

const createMockSpatialRuntime = (
  neighbors: Record<string, string[]>
): SpatialRuntime => {
  const neighborMap = new Map(Object.entries(neighbors));
  return {
    model: 'discrete',
    async getLocationState(_entityId: string) {
      return null;
    },
    async getLocation(_entityId: string) {
      return null;
    },
    neighbors(locationId: string) {
      return neighborMap.get(locationId) ?? [];
    },
    distance(_a: string, _b: string) {
      return null;
    },
    async moveEntity(_entityId: string, _targetLocation: string, _now: bigint) {
      // noop
    }
  };
};

describe('spatialPredicateMatches', () => {
  it('returns true when no spatial condition present', () => {
    const sr = createMockSpatialRuntime({});
    expect(spatialPredicateMatches({}, 'kitchen', sr)).toBe(true);
  });

  it('returns true when location.in contains subject location', () => {
    const sr = createMockSpatialRuntime({});
    expect(spatialPredicateMatches({ in: ['kitchen', 'library'] }, 'kitchen', sr)).toBe(true);
  });

  it('returns false when location.in does not contain subject location', () => {
    const sr = createMockSpatialRuntime({});
    expect(spatialPredicateMatches({ in: ['kitchen', 'library'] }, 'basement', sr)).toBe(false);
  });

  it('returns false when location.in is checked but subject has no location', () => {
    const sr = createMockSpatialRuntime({});
    expect(spatialPredicateMatches({ in: ['kitchen'] }, null, sr)).toBe(false);
  });

  it('returns true when subject is adjacent to target location', () => {
    const sr = createMockSpatialRuntime({ kitchen: ['library', 'dining'] });
    expect(spatialPredicateMatches({ adjacent_to: 'kitchen' }, 'library', sr)).toBe(true);
  });

  it('returns true when subject IS the target location', () => {
    const sr = createMockSpatialRuntime({ kitchen: ['library'] });
    expect(spatialPredicateMatches({ adjacent_to: 'kitchen' }, 'kitchen', sr)).toBe(true);
  });

  it('returns false when subject is not adjacent to target', () => {
    const sr = createMockSpatialRuntime({ kitchen: ['library'] });
    expect(spatialPredicateMatches({ adjacent_to: 'kitchen' }, 'basement', sr)).toBe(false);
  });

  it('returns false when adjacent_to checked but subject has no location', () => {
    const sr = createMockSpatialRuntime({ kitchen: ['library'] });
    expect(spatialPredicateMatches({ adjacent_to: 'kitchen' }, null, sr)).toBe(false);
  });

  it('combines both conditions — both must pass', () => {
    const sr = createMockSpatialRuntime({ kitchen: ['library'] });
    // in check fails, adjacent_to passes → overall false
    expect(spatialPredicateMatches({ in: ['tavern'], adjacent_to: 'kitchen' }, 'library', sr)).toBe(false);
  });

  it('combines both conditions — both pass', () => {
    const sr = createMockSpatialRuntime({ kitchen: ['library'] });
    expect(spatialPredicateMatches({ in: ['library'], adjacent_to: 'kitchen' }, 'library', sr)).toBe(true);
  });
});
