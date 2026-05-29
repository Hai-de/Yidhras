import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { evaluateStateTransforms } from '../../../src/packs/runtime/state_transform_evaluator.js';
import { expectDefined } from '../../helpers/assertions.js';

// ---- Helpers ---------------------------------------------------------------

const noopLogger = {
  logDebug: () => {},
  logWarn: () => {}
};

const arbitraryStateJson = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 8 }).filter(k => k !== '__proto__' && k !== 'constructor'),
  fc.oneof(
    fc.integer({ min: 0, max: 100 }),
    fc.float({ min: 0, max: 100, noNaN: true }),
    fc.string({ minLength: 1, maxLength: 20 })
  )
);

const arbitraryRange = fc.record({
  min: fc.integer({ min: 0, max: 50 }),
  max: fc.integer({ min: 51, max: 100 }),
  label: fc.string({ minLength: 1, maxLength: 10 })
});

const arbitraryActorState = fc.record({
  entity_id: fc.uuid(),
  state_json: arbitraryStateJson
});

// ---- State Transform Evaluator ---------------------------------------------

describe('evaluateStateTransforms — property-based', () => {
  it('returns empty array when actorStates is empty', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.array(arbitraryActorState, { minLength: 0, maxLength: 0 }),
        fc.array(
          fc.record({
            source: fc.string({ minLength: 1 }),
            ranges: fc.array(arbitraryRange, { minLength: 1 }),
            target: fc.string({ minLength: 1 })
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (packId, actorStates, transformDefs) => {
          const result = evaluateStateTransforms({
            packId,
            actorStates,
            transformDefs,
            ...noopLogger
          });
          expect(result).toEqual([]);
        }
      )
    );
  });

  it('returns empty array when transformDefs is empty', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.array(arbitraryActorState, { minLength: 1, maxLength: 5 }),
        fc.constant([] as Array<{ source: string; ranges: Array<{ min: number; max: number; label: string }>; target: string }>),
        (packId, actorStates, transformDefs) => {
          const result = evaluateStateTransforms({
            packId,
            actorStates,
            transformDefs,
            ...noopLogger
          });
          expect(result).toEqual([]);
        }
      )
    );
  });

  it('only emits upsert_entity_state operations', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.array(arbitraryActorState, { minLength: 1, maxLength: 5 }),
        fc.array(
          fc.record({
            source: fc.string({ minLength: 1, maxLength: 4 }).filter(k => k !== '__proto__'),
            ranges: fc.array(arbitraryRange, { minLength: 2, maxLength: 5 }),
            target: fc.string({ minLength: 1, maxLength: 4 }).filter(k => k !== '__proto__')
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (packId, actorStates, transformDefs) => {
          const result = evaluateStateTransforms({
            packId,
            actorStates,
            transformDefs,
            ...noopLogger
          });

          for (const op of result) {
            expect(op.op).toBe('upsert_entity_state');
            expect(typeof op.target_ref).toBe('string');
            expect(op.namespace).toBe('core');
            expect(op.payload).toBeDefined();
            expect(typeof op.payload.next).toBe('object');
            expect(typeof op.payload.previous).toBe('object');
            expect(op.payload.reason).toBe('state_transform_evaluation');
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('never mutates input actor states (idempotent reads)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.array(arbitraryActorState, { minLength: 1, maxLength: 5 }),
        fc.array(
          fc.record({
            source: fc.string({ minLength: 1, maxLength: 4 }).filter(k => k !== '__proto__'),
            ranges: fc.array(arbitraryRange, { minLength: 1, maxLength: 3 }),
            target: fc.string({ minLength: 1, maxLength: 4 }).filter(k => k !== '__proto__')
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (packId, actorStates, transformDefs) => {
          const frozen = structuredClone(actorStates);

          evaluateStateTransforms({
            packId,
            actorStates,
            transformDefs,
            ...noopLogger
          });

          // Input actor states must be unchanged
          expect(actorStates).toEqual(frozen);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('target keys in output are subset of declared transform targets', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.array(arbitraryActorState, { minLength: 1, maxLength: 5 }),
        fc.array(
          fc.record({
            source: fc.string({ minLength: 1, maxLength: 4 }).filter(k => k !== '__proto__'),
            ranges: fc.array(arbitraryRange, { minLength: 2, maxLength: 5 }),
            target: fc.string({ minLength: 1, maxLength: 4 }).filter(k => k !== '__proto__')
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (packId, actorStates, transformDefs) => {
          const declaredTargets = new Set(transformDefs.map(t => t.target));

          const result = evaluateStateTransforms({
            packId,
            actorStates,
            transformDefs,
            ...noopLogger
          });

          for (const op of result) {
            const next = op.payload.next as Record<string, unknown>;
            const previous = op.payload.previous as Record<string, unknown>;

            for (const key of Object.keys(next)) {
              if (next[key] !== previous[key]) {
                // Changed keys must be declared targets
                expect(declaredTargets.has(key)).toBe(true);
              }
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---- Semver Compatibility --------------------------------------------------

const parseSemver = (version: string): { major: number; minor: number; patch: number } | null => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10)
  };
};

const isHostApiCompatible = (serverVersion: string, requiredVersion: string): boolean => {
  const server = parseSemver(serverVersion);
  const required = parseSemver(requiredVersion);
  if (!server || !required) return false;
  if (server.major !== required.major) return false;
  if (server.minor > required.minor) return true;
  if (server.minor === required.minor && server.patch >= required.patch) return true;
  return false;
};

const arbitrarySemver = fc.tuple(
  fc.integer({ min: 0, max: 5 }),
  fc.integer({ min: 0, max: 20 }),
  fc.integer({ min: 0, max: 99 })
).map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

const arbitraryBadVersion = fc.string({ minLength: 1, maxLength: 20 }).filter(s => {
  return !/^\d+\.\d+\.\d+$/.test(s);
});

describe('isHostApiCompatible — property-based', () => {
  it('is reflexive — same version is always compatible', () => {
    fc.assert(
      fc.property(arbitrarySemver, (version) => {
        expect(isHostApiCompatible(version, version)).toBe(true);
      })
    );
  });

  it('is monotonic — newer server accepts older requirement', () => {
    fc.assert(
      fc.property(
        arbitrarySemver,
        arbitrarySemver,
        (older, newer) => {
          const o = expectDefined(parseSemver(older), `parsed semver ${older}`);
          const n = expectDefined(parseSemver(newer), `parsed semver ${newer}`);

          // If newer >= older and same major, must be compatible
          const isNewer =
            n.major === o.major &&
            (n.minor > o.minor || (n.minor === o.minor && n.patch >= o.patch));

          if (isNewer) {
            expect(isHostApiCompatible(newer, older)).toBe(true);
          }
        }
      )
    );
  });

  it('rejects different major versions', () => {
    fc.assert(
      fc.property(
        arbitrarySemver,
        arbitrarySemver,
        (v1, v2) => {
          const a = expectDefined(parseSemver(v1), `parsed semver ${v1}`);
          const b = expectDefined(parseSemver(v2), `parsed semver ${v2}`);

          if (a.major !== b.major) {
            expect(isHostApiCompatible(v1, v2)).toBe(false);
          }
        }
      )
    );
  });

  it('rejects malformed version strings', () => {
    fc.assert(
      fc.property(
        arbitraryBadVersion,
        arbitrarySemver,
        (bad, good) => {
          expect(isHostApiCompatible(bad, good)).toBe(false);
          expect(isHostApiCompatible(good, bad)).toBe(false);
        }
      )
    );
  });
});

// ---- Range Matching (extracted for property testing) -----------------------

const findMatchingLabel = (
  value: number,
  ranges: Array<{ min: number; max: number; label: string }>
): string | null => {
  for (const range of ranges) {
    if (value >= range.min && value <= range.max) {
      return range.label;
    }
  }
  return null;
};

describe('findMatchingLabel — property-based', () => {
  it('returns null when all ranges are above the value', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 50 }),
        fc.array(
          fc.record({
            min: fc.integer({ min: 51, max: 100 }),
            max: fc.integer({ min: 101, max: 200 }),
            label: fc.string({ minLength: 1 })
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (value, ranges) => {
          expect(findMatchingLabel(value, ranges)).toBeNull();
        }
      )
    );
  });

  it('returns null when all ranges are below the value', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 201, max: 500 }),
        fc.array(
          fc.record({
            min: fc.integer({ min: 51, max: 100 }),
            max: fc.integer({ min: 101, max: 200 }),
            label: fc.string({ minLength: 1 })
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (value, ranges) => {
          expect(findMatchingLabel(value, ranges)).toBeNull();
        }
      )
    );
  });

  it('returns a label from the matching range for any value within ranges', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.array(
          fc.record({
            min: fc.integer({ min: 0, max: 50 }),
            max: fc.integer({ min: 51, max: 100 }),
            label: fc.string({ minLength: 1, maxLength: 8 })
          }),
          { minLength: 2, maxLength: 6 }
        ),
        (value, ranges) => {
          // If value falls in at least one range, result must be non-null
          const hasMatch = ranges.some(r => value >= r.min && value <= r.max);
          const result = findMatchingLabel(value, ranges);

          if (hasMatch) {
            expect(result).not.toBeNull();
            // Result must be one of the declared labels
            const labels = new Set(ranges.map(r => r.label));
            const label = expectDefined(result, 'matching label');
            expect(labels.has(label)).toBe(true);
          }
          // Note: result can be null even without hasMatch
        }
      )
    );
  });

  it('returns the first matching range (stable order)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.array(
          fc.record({
            min: fc.integer({ min: 0, max: 50 }),
            max: fc.integer({ min: 51, max: 100 }),
            label: fc.string({ minLength: 1, maxLength: 8 })
          }),
          { minLength: 2, maxLength: 6 }
        ),
        (value, ranges) => {
          // Running the same input twice must yield the same label
          const first = findMatchingLabel(value, ranges);
          const second = findMatchingLabel(value, ranges);

          // Shift ranges and run again — labels should be consistent
          const firstMatchIndex = ranges.findIndex(
            r => value >= r.min && value <= r.max
          );

          if (firstMatchIndex >= 0) {
            expect(first).toBe(ranges[firstMatchIndex].label);
          }

          expect(first).toBe(second);
        }
      )
    );
  });
});
