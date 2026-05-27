import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { deepMerge, deepMergeAll } from '../../src/config/merge.js';
import { normalizeForStableJson, stableJsonStringify } from '../../src/determinism/stable_json.js';
import { applyStateTransitions, createInitialBehaviorState } from '../../src/inference/slot_behavior_state.js';
import { stringifyJsonSafe,toJsonSafe } from '../../src/packs/storage/internal/json.js';

// ---- Shared arbitraries ----------------------------------------------------

const arbitraryJsonPrimitive = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer({ min: -1000, max: 1000 }),
  fc.float({ min: -1000, max: 1000, noNaN: true }),
  fc.string({ minLength: 0, maxLength: 50 })
);

const arbitrarySafeKey = fc
  .string({ minLength: 1, maxLength: 8 })
  .filter(k => k !== '__proto__' && k !== 'constructor' && k !== 'prototype');

const arbitraryFlatRecord = fc.dictionary(arbitrarySafeKey, arbitraryJsonPrimitive);

// ---- deepMerge --------------------------------------------------------------

describe('deepMerge — property-based', () => {
  it('is idempotent: deepMerge(a, a) deep-equals a', () => {
    fc.assert(
      fc.property(arbitraryFlatRecord, a => {
        expect(deepMerge(a, a)).toEqual(a);
      })
    );
  });

  it('has identity element: deepMerge(a, {}) deep-equals a', () => {
    fc.assert(
      fc.property(arbitraryFlatRecord, a => {
        expect(deepMerge(a, {})).toEqual(a);
      })
    );
  });

  it('preserves keys only in base (no key loss)', () => {
    fc.assert(
      fc.property(
        arbitraryFlatRecord,
        fc.dictionary(arbitrarySafeKey, arbitraryJsonPrimitive),
        (base, override) => {
          const result = deepMerge(base, override);
          for (const key of Object.keys(base)) {
            expect(result).toHaveProperty(key);
          }
        }
      )
    );
  });

  it('applies all override keys to result', () => {
    fc.assert(
      fc.property(
        arbitraryFlatRecord,
        fc.dictionary(arbitrarySafeKey, arbitraryJsonPrimitive),
        (base, override) => {
          const result = deepMerge(base, override);
          for (const key of Object.keys(override)) {
            // undefined values in override are skipped
            // eslint-disable-next-line security/detect-object-injection -- key from Object.keys
            if (override[key] !== undefined) {
              expect(result).toHaveProperty(key);
            }
          }
        }
      )
    );
  });

  it('skips undefined values in override (keeps base value)', () => {
    fc.assert(
      fc.property(
        arbitraryFlatRecord,
        arbitrarySafeKey,
        arbitraryJsonPrimitive.filter(v => v !== undefined),
        (base, key, baseValue) => {
          const withValue = { ...base, [key]: baseValue };
          const override = { [key]: undefined };
          const result = deepMerge(withValue, override);
          // eslint-disable-next-line security/detect-object-injection -- key from arbitrary safe key
          expect(result[key]).toEqual(baseValue);
        }
      )
    );
  });

  it('override with same keys as base is idempotent (absorption)', () => {
    fc.assert(
      fc.property(
        arbitraryFlatRecord,
        fc.dictionary(arbitrarySafeKey, arbitraryJsonPrimitive),
        (base, override) => {
          const once = deepMerge(base, override);
          const twice = deepMerge(once, override);
          expect(twice).toEqual(once);
        }
      )
    );
  });

  it('does not mutate input objects', () => {
    fc.assert(
      fc.property(
        arbitraryFlatRecord,
        fc.dictionary(arbitrarySafeKey, arbitraryJsonPrimitive),
        (base, override) => {
          const baseFrozen = structuredClone(base);
          const overrideFrozen = structuredClone(override);
          deepMerge(base, override);
          expect(base).toEqual(baseFrozen);
          expect(override).toEqual(overrideFrozen);
        }
      )
    );
  });

  it('recursively merges nested plain objects', () => {
    fc.assert(
      fc.property(
        arbitraryFlatRecord,
        arbitrarySafeKey,
        arbitraryFlatRecord,
        arbitraryFlatRecord,
        (base, nestedKey, nestedA, nestedB) => {
          const a = { ...base, [nestedKey]: nestedA };
          const b = { [nestedKey]: nestedB };
          const result = deepMerge(a, b);
          // eslint-disable-next-line security/detect-object-injection -- key from arbitrary safe key
          const merged = result[nestedKey] as Record<string, unknown>;
          // Keys from both nestedA and nestedB should be present
          for (const k of Object.keys(nestedA)) {
            expect(merged).toHaveProperty(k);
          }
          for (const k of Object.keys(nestedB)) {
            // eslint-disable-next-line security/detect-object-injection -- key from Object.keys
            if (nestedB[k] !== undefined) {
              expect(merged).toHaveProperty(k);
            }
          }
        }
      )
    );
  });

  it('replaces arrays instead of merging them', () => {
    fc.assert(
      fc.property(arbitrarySafeKey, fc.array(fc.integer()), fc.array(fc.integer()), (key, arr1, arr2) => {
        const base = { [key]: arr1 };
        const override = { [key]: arr2 };
        const result = deepMerge(base, override);
        // eslint-disable-next-line security/detect-object-injection -- key from arbitrary safe key
        expect(result[key]).toEqual(arr2);
      })
    );
  });
});

// ---- deepMergeAll -----------------------------------------------------------

describe('deepMergeAll — property-based', () => {
  it('deepMergeAll(a, b) equals deepMerge(a, b)', () => {
    fc.assert(
      fc.property(arbitraryFlatRecord, arbitraryFlatRecord, (a, b) => {
        expect(deepMergeAll(a, b)).toEqual(deepMerge(a, b));
      })
    );
  });

  it('deepMergeAll(a, b, c) equals deepMerge(deepMerge(a, b), c)', () => {
    fc.assert(
      fc.property(arbitraryFlatRecord, arbitraryFlatRecord, arbitraryFlatRecord, (a, b, c) => {
        expect(deepMergeAll(a, b, c)).toEqual(deepMerge(deepMerge(a, b), c));
      })
    );
  });

  it('does not mutate the base input', () => {
    fc.assert(
      fc.property(arbitraryFlatRecord, arbitraryFlatRecord, (a, b) => {
        const frozen = structuredClone(a);
        deepMergeAll(a, b);
        expect(a).toEqual(frozen);
      })
    );
  });

  it('returns clone of base when no overrides given', () => {
    fc.assert(
      fc.property(arbitraryFlatRecord, a => {
        const result = deepMergeAll(a);
        expect(result).toEqual(a);
        expect(result).not.toBe(a);
      })
    );
  });
});

// ---- stable_json (normalizeForStableJson / stableJsonStringify) -------------

const arbitraryNonFiniteNumber = fc.oneof(
  fc.constant(Number.NaN),
  fc.constant(Number.POSITIVE_INFINITY),
  fc.constant(Number.NEGATIVE_INFINITY)
);

const arbitraryBigInt = fc.bigInt({ min: -(2n ** 53n), max: 2n ** 53n });

const arbitraryDate = fc.date().map(d => new Date(d.getTime()));

describe('normalizeForStableJson — property-based', () => {
  it('is idempotent: normalize(normalize(x)) deep-equals normalize(x)', () => {
    fc.assert(
      fc.property(fc.json(), x => {
        const once = normalizeForStableJson(x);
        const twice = normalizeForStableJson(once);
        expect(twice).toEqual(once);
      }),
      { numRuns: 500 }
    );
  });

  it('is deterministic: same input always produces identical output', () => {
    fc.assert(
      fc.property(fc.json(), x => {
        const a = normalizeForStableJson(x);
        const b = normalizeForStableJson(x);
        expect(a).toEqual(b);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      })
    );
  });

  it('converts NaN, Infinity, -Infinity to strings', () => {
    fc.assert(
      fc.property(arbitraryNonFiniteNumber, n => {
        const result = normalizeForStableJson(n);
        expect(typeof result).toBe('string');
      })
    );
  });

  it('converts bigint to string', () => {
    fc.assert(
      fc.property(arbitraryBigInt, n => {
        const result = normalizeForStableJson(n);
        expect(typeof result).toBe('string');
        expect(result).toBe(n.toString());
      })
    );
  });

  it('converts Date to ISO string', () => {
    fc.assert(
      fc.property(arbitraryDate, d => {
        const result = normalizeForStableJson(d);
        expect(typeof result).toBe('string');
        expect(result).toBe(d.toISOString());
      })
    );
  });

  it('maps null / undefined to null', () => {
    expect(normalizeForStableJson(null)).toBeNull();
    expect(normalizeForStableJson(undefined)).toBeNull();
  });

  it('normalizes -0 to 0', () => {
    const result = normalizeForStableJson(-0);
    expect(result).toBe(0);
    expect(Object.is(result, -0)).toBe(false);
  });

  it('produces deterministic key order for non-integer string keys', () => {
    // Keys that are pure alphabetic strings (no numeric index quirk in V8)
    const alphaKey = fc.string({ minLength: 1, maxLength: 8 }).filter(
      k => /^[a-zA-Z]+$/.test(k)
    );
    fc.assert(
      fc.property(fc.dictionary(alphaKey, fc.integer()), obj => {
        const normalized = normalizeForStableJson(obj) as Record<string, unknown>;
        const keys = Object.keys(normalized);
        const sorted = [...keys].sort();
        expect(keys).toEqual(sorted);
      })
    );
  });

  it('stableJsonStringify output is deterministic even with integer-like keys', () => {
    fc.assert(
      fc.property(fc.dictionary(arbitrarySafeKey, fc.integer()), obj => {
        // Multiple calls with same input must produce identical strings
        expect(stableJsonStringify(obj)).toBe(stableJsonStringify(obj));
      })
    );
  });

  it('excludes ignoredKeys from normalized output', () => {
    fc.assert(
      fc.property(
        fc.dictionary(arbitrarySafeKey, fc.integer()),
        arbitrarySafeKey,
        (obj, ignoreKey) => {
          const withKey: Record<string, unknown> = { ...obj, [ignoreKey]: 42 };
          const normalized = normalizeForStableJson(withKey, { ignoredKeys: [ignoreKey] }) as Record<
            string,
            unknown
          >;
          expect(Object.keys(normalized)).not.toContain(ignoreKey);
        }
      )
    );
  });

  it('recursively normalizes arrays', () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.integer(), fc.string())), arr => {
        const normalized = normalizeForStableJson(arr);
        expect(Array.isArray(normalized)).toBe(true);
        expect((normalized as unknown[]).length).toBe(arr.length);
      })
    );
  });
});

describe('stableJsonStringify — property-based', () => {
  it('never throws for any JSON value', () => {
    fc.assert(
      fc.property(fc.json(), x => {
        expect(() => stableJsonStringify(x)).not.toThrow();
      })
    );
  });

  it('produces valid JSON output', () => {
    fc.assert(
      fc.property(fc.json(), x => {
        const str = stableJsonStringify(x);
        expect(() => JSON.parse(str)).not.toThrow();
      })
    );
  });

  it('produces identical output for identical input (determinism)', () => {
    fc.assert(
      fc.property(fc.json(), x => {
        expect(stableJsonStringify(x)).toBe(stableJsonStringify(x));
      })
    );
  });

  it('produces key-sorted JSON strings', () => {
    const result = stableJsonStringify({ c: 1, a: 2, b: 3 });
    expect(result).toBe('{"a":2,"b":3,"c":1}');
  });
});

// ---- toJsonSafe / stringifyJsonSafe -----------------------------------------

describe('toJsonSafe — property-based', () => {
  it('is idempotent: toJsonSafe(toJsonSafe(x)) deep-equals toJsonSafe(x)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          arbitraryJsonPrimitive,
          fc.bigInt({ min: -(2n ** 53n), max: 2n ** 53n }),
          fc.array(arbitraryJsonPrimitive),
          fc.dictionary(arbitrarySafeKey, arbitraryJsonPrimitive)
        ),
        x => {
          const once = toJsonSafe(x);
          const twice = toJsonSafe(once);
          expect(twice).toEqual(once);
        }
      )
    );
  });

  it('converts bigint to string', () => {
    fc.assert(
      fc.property(fc.bigInt(), n => {
        expect(typeof toJsonSafe(n)).toBe('string');
        expect(toJsonSafe(n)).toBe(n.toString());
      })
    );
  });

  it('does not alter plain primitives', () => {
    fc.assert(
      fc.property(fc.oneof(fc.boolean(), fc.integer(), fc.string()), x => {
        expect(toJsonSafe(x)).toBe(x);
      })
    );
  });

  it('recursively transforms array elements', () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: -100n, max: 100n }), { minLength: 1, maxLength: 10 }), arr => {
        const result = toJsonSafe(arr) as unknown[];
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(arr.length);
        for (const item of result) {
          expect(typeof item).toBe('string');
        }
      })
    );
  });

  it('recursively transforms nested object values', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          arbitrarySafeKey,
          fc.oneof(fc.bigInt({ min: -100n, max: 100n }), arbitraryJsonPrimitive)
        ),
        obj => {
          const result = toJsonSafe(obj) as Record<string, unknown>;
          for (const val of Object.values(result)) {
            // bigints should be converted, primitives unchanged
            expect(typeof val === 'bigint').toBe(false);
          }
        }
      )
    );
  });
});

describe('stringifyJsonSafe — property-based', () => {
  it('never throws', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.json(),
          fc.bigInt(),
          fc.array(fc.oneof(fc.json(), fc.bigInt())),
          fc.dictionary(fc.string(), fc.oneof(fc.json(), fc.bigInt()))
        ),
        x => {
          expect(() => stringifyJsonSafe(x)).not.toThrow();
        }
      )
    );
  });

  it('produces valid JSON', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.json(), fc.bigInt(), fc.dictionary(fc.string(), fc.oneof(fc.json(), fc.bigInt()))),
        x => {
          expect(() => JSON.parse(stringifyJsonSafe(x))).not.toThrow();
        }
      )
    );
  });
});

// ---- applyStateTransitions (5-state machine) ---------------------------------

const VALID_STATUSES = ['Pending', 'Delayed', 'Active', 'Retained', 'Cooling'] as const;

const arbitraryValidStatus = fc.constantFrom(...VALID_STATUSES);

const arbitrarySlotBehaviorState = fc.record<{
  slot_id: string;
  status: 'Pending' | 'Delayed' | 'Active' | 'Retained' | 'Cooling';
  sticky_remaining?: number;
  cooldown_until_tick?: number;
  delay_until_tick?: number;
  recursion_depth?: number;
  last_activated_tick?: number;
  trigger_count: number;
}>({
  slot_id: fc.uuid(),
  status: arbitraryValidStatus,
  sticky_remaining: fc.oneof(fc.constant(undefined), fc.integer({ min: 1, max: 10 })),
  cooldown_until_tick: fc.oneof(fc.constant(undefined), fc.integer({ min: 0, max: 10_000 })),
  delay_until_tick: fc.oneof(fc.constant(undefined), fc.integer({ min: 0, max: 10_000 })),
  recursion_depth: fc.oneof(fc.constant(undefined), fc.integer({ min: 0, max: 5 })),
  last_activated_tick: fc.oneof(fc.constant(undefined), fc.integer({ min: 0, max: 10_000 })),
  trigger_count: fc.integer({ min: 0, max: 100 })
});

const arbitraryTransitionInput = fc.record({
  conditionMet: fc.boolean(),
  currentTick: fc.integer({ min: 0, max: 10_000 }),
  stickyMaxActivations: fc.oneof(fc.constant(undefined), fc.integer({ min: 1, max: 10 })),
  cooldownTicks: fc.oneof(fc.constant(undefined), fc.integer({ min: 1, max: 100 })),
  delayTicks: fc.oneof(fc.constant(undefined), fc.integer({ min: 1, max: 100 }))
});

describe('applyStateTransitions — property-based', () => {
  it('always returns a valid status', () => {
    fc.assert(
      fc.property(arbitrarySlotBehaviorState, arbitraryTransitionInput, (state, input) => {
        const result = applyStateTransitions(state, input);
        expect(VALID_STATUSES).toContain(result.status);
      })
    );
  });

  it('trigger_count is monotonic non-decreasing', () => {
    fc.assert(
      fc.property(arbitrarySlotBehaviorState, arbitraryTransitionInput, (state, input) => {
        const result = applyStateTransitions(state, input);
        expect(result.trigger_count).toBeGreaterThanOrEqual(state.trigger_count);
      })
    );
  });

  it('trigger_count increments by at most 1 per transition', () => {
    fc.assert(
      fc.property(arbitrarySlotBehaviorState, arbitraryTransitionInput, (state, input) => {
        const result = applyStateTransitions(state, input);
        const diff = result.trigger_count - state.trigger_count;
        expect(diff).toBeGreaterThanOrEqual(0);
        expect(diff).toBeLessThanOrEqual(1);
      })
    );
  });

  it('from Pending without conditionMet stays Pending', () => {
    fc.assert(
      fc.property(
        fc.record({
          slot_id: fc.uuid(),
          status: fc.constant('Pending' as const),
          trigger_count: fc.integer({ min: 0, max: 100 })
        }),
        arbitraryTransitionInput.filter(i => !i.conditionMet),
        (state, input) => {
          const result = applyStateTransitions(state, input);
          expect(result.status).toBe('Pending');
        }
      )
    );
  });

  it('from Pending with conditionMet goes to Delayed (with delay) or Active (without delay)', () => {
    fc.assert(
      fc.property(
        fc.record({
          slot_id: fc.uuid(),
          status: fc.constant('Pending' as const),
          trigger_count: fc.integer({ min: 0, max: 100 })
        }),
        arbitraryTransitionInput.filter(i => i.conditionMet),
        (state, input) => {
          const result = applyStateTransitions(state, input);
          if (input.delayTicks && input.delayTicks > 0) {
            expect(result.status).toBe('Delayed');
            expect(result.delay_until_tick).toBe(input.currentTick + input.delayTicks);
          } else {
            expect(result.status).toBe('Active');
            expect(result.last_activated_tick).toBe(input.currentTick);
            expect(result.trigger_count).toBe(state.trigger_count + 1);
          }
        }
      )
    );
  });

  it('from Delayed stays Delayed until tick reaches delay_until_tick', () => {
    fc.assert(
      fc.property(
        fc.record({
          slot_id: fc.uuid(),
          status: fc.constant('Delayed' as const),
          delay_until_tick: fc.integer({ min: 100, max: 200 }),
          trigger_count: fc.integer({ min: 0, max: 100 })
        }),
        arbitraryTransitionInput.filter(i => i.currentTick < 100),
        (state, input) => {
          const result = applyStateTransitions(state, input);
          expect(result.status).toBe('Delayed');
        }
      )
    );
  });

  it('from Delayed transitions to Active when tick reaches delay_until_tick', () => {
    fc.assert(
      fc.property(
        fc.record({
          slot_id: fc.uuid(),
          status: fc.constant('Delayed' as const),
          delay_until_tick: fc.integer({ min: 0, max: 100 }),
          trigger_count: fc.integer({ min: 0, max: 100 })
        }),
        arbitraryTransitionInput.filter(i => i.currentTick >= 200),
        (state, input) => {
          const result = applyStateTransitions(state, input);
          expect(result.status).toBe('Active');
          expect(result.trigger_count).toBe(state.trigger_count + 1);
          expect(result.delay_until_tick).toBeUndefined();
        }
      )
    );
  });

  it('from Active with cooldown goes to Cooling (cooldown overrides sticky)', () => {
    fc.assert(
      fc.property(
        fc.record({
          slot_id: fc.uuid(),
          status: fc.constant('Active' as const),
          sticky_remaining: fc.integer({ min: 1, max: 10 }),
          trigger_count: fc.integer({ min: 0, max: 100 })
        }),
        arbitraryTransitionInput.filter(i => i.cooldownTicks !== undefined && i.cooldownTicks > 0),
        (state, input) => {
          const cooldownTicks = input.cooldownTicks as number;
          const result = applyStateTransitions(state, input);
          expect(result.status).toBe('Cooling');
          expect(result.cooldown_until_tick).toBe(input.currentTick + cooldownTicks);
          expect(result.sticky_remaining).toBeUndefined();
        }
      )
    );
  });

  it('from Active with sticky and no cooldown goes to Retained', () => {
    fc.assert(
      fc.property(
        fc.record({
          slot_id: fc.uuid(),
          status: fc.constant('Active' as const),
          sticky_remaining: fc.integer({ min: 1, max: 10 }),
          trigger_count: fc.integer({ min: 0, max: 100 })
        }),
        arbitraryTransitionInput.filter(i => !i.cooldownTicks || i.cooldownTicks <= 0),
        (state, input) => {
          const result = applyStateTransitions(state, input);
          expect(result.status).toBe('Retained');
          expect(result.sticky_remaining).toBe((state.sticky_remaining ?? 1) - 1);
        }
      )
    );
  });

  it('from Active with no sticky and no cooldown goes to Pending', () => {
    fc.assert(
      fc.property(
        fc.record({
          slot_id: fc.uuid(),
          status: fc.constant('Active' as const),
          sticky_remaining: fc.constant(undefined),
          trigger_count: fc.integer({ min: 0, max: 100 })
        }),
        arbitraryTransitionInput.filter(i => !i.cooldownTicks || i.cooldownTicks <= 0),
        (state, input) => {
          const result = applyStateTransitions(state, input);
          expect(result.status).toBe('Pending');
        }
      )
    );
  });

  it('from Cooling stays Cooling until cooldown_until_tick is reached', () => {
    fc.assert(
      fc.property(
        fc.record({
          slot_id: fc.uuid(),
          status: fc.constant('Cooling' as const),
          cooldown_until_tick: fc.integer({ min: 500, max: 1000 }),
          trigger_count: fc.integer({ min: 0, max: 100 })
        }),
        arbitraryTransitionInput.filter(i => i.currentTick < 500),
        (state, input) => {
          const result = applyStateTransitions(state, input);
          expect(result.status).toBe('Cooling');
        }
      )
    );
  });

  it('from Cooling transitions to Pending when cooldown ends', () => {
    fc.assert(
      fc.property(
        fc.record({
          slot_id: fc.uuid(),
          status: fc.constant('Cooling' as const),
          cooldown_until_tick: fc.integer({ min: 0, max: 100 }),
          trigger_count: fc.integer({ min: 0, max: 100 })
        }),
        arbitraryTransitionInput.filter(i => i.currentTick >= 200),
        (state, input) => {
          const result = applyStateTransitions(state, input);
          expect(result.status).toBe('Pending');
          expect(result.cooldown_until_tick).toBeUndefined();
        }
      )
    );
  });

  it('Cooling blocks activation even when conditionMet is true', () => {
    fc.assert(
      fc.property(
        fc.record({
          slot_id: fc.uuid(),
          status: fc.constant('Cooling' as const),
          cooldown_until_tick: fc.integer({ min: 500, max: 1000 }),
          trigger_count: fc.integer({ min: 0, max: 100 })
        }),
        arbitraryTransitionInput.filter(i => i.currentTick < 500 && i.conditionMet),
        (state, input) => {
          const result = applyStateTransitions(state, input);
          expect(result.status).toBe('Cooling');
          expect(result.trigger_count).toBe(state.trigger_count);
        }
      )
    );
  });

  it('Retained with conditionMet increments trigger_count and decrements sticky', () => {
    fc.assert(
      fc.property(
        fc.record({
          slot_id: fc.uuid(),
          status: fc.constant('Retained' as const),
          sticky_remaining: fc.integer({ min: 1, max: 10 }),
          trigger_count: fc.integer({ min: 0, max: 100 })
        }),
        fc.record({
          conditionMet: fc.constant(true),
          currentTick: fc.integer({ min: 0, max: 1000 }),
          stickyMaxActivations: fc.constant(undefined),
          cooldownTicks: fc.constant(undefined),
          delayTicks: fc.constant(undefined)
        }),
        (state, input) => {
          const result = applyStateTransitions(state, input);
          expect(result.trigger_count).toBe(state.trigger_count + 1);
          expect(result.sticky_remaining).toBe((state.sticky_remaining ?? 0) - 1);
        }
      )
    );
  });

  it('Retained without conditionMet and without cooldown goes to Pending', () => {
    fc.assert(
      fc.property(
        fc.record({
          slot_id: fc.uuid(),
          status: fc.constant('Retained' as const),
          sticky_remaining: fc.integer({ min: 0, max: 10 }),
          trigger_count: fc.integer({ min: 0, max: 100 })
        }),
        fc.record({
          conditionMet: fc.constant(false),
          currentTick: fc.integer({ min: 0, max: 1000 }),
          stickyMaxActivations: fc.constant(undefined),
          cooldownTicks: fc.constant(undefined),
          delayTicks: fc.constant(undefined)
        }),
        (state, input) => {
          const result = applyStateTransitions(state, input);
          expect(result.status).toBe('Pending');
          expect(result.sticky_remaining).toBeUndefined();
        }
      )
    );
  });

  it('does not mutate the input state object', () => {
    fc.assert(
      fc.property(arbitrarySlotBehaviorState, arbitraryTransitionInput, (state, input) => {
        const frozen = structuredClone(state);
        applyStateTransitions(state, input);
        expect(state).toEqual(frozen);
      })
    );
  });

  it('sticky_remaining is never negative', () => {
    fc.assert(
      fc.property(arbitrarySlotBehaviorState, arbitraryTransitionInput, (state, input) => {
        const result = applyStateTransitions(state, input);
        if (result.sticky_remaining !== undefined) {
          expect(result.sticky_remaining).toBeGreaterThanOrEqual(0);
        }
      })
    );
  });
});

// ---- createInitialBehaviorState ---------------------------------------------

describe('createInitialBehaviorState — property-based', () => {
  it('creates state with Pending status and zero trigger_count', () => {
    fc.assert(
      fc.property(fc.uuid(), slotId => {
        const state = createInitialBehaviorState(slotId);
        expect(state.status).toBe('Pending');
        expect(state.trigger_count).toBe(0);
        expect(state.slot_id).toBe(slotId);
      })
    );
  });
});

// ---- State machine sequence properties (model-based) -------------------------

describe('applyStateTransitions — sequence properties', () => {
  it('after any sequence of transitions from initial state, status is always valid', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.array(arbitraryTransitionInput, { minLength: 1, maxLength: 50 }),
        (slotId, inputs) => {
          let state = createInitialBehaviorState(slotId);
          for (const input of inputs) {
            state = applyStateTransitions(state, input);
            expect(VALID_STATUSES).toContain(state.status);
            if (state.sticky_remaining !== undefined) {
              expect(state.sticky_remaining).toBeGreaterThanOrEqual(0);
            }
          }
        }
      )
    );
  });

  it('trigger_count never decreases across any sequence', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.array(arbitraryTransitionInput, { minLength: 1, maxLength: 50 }),
        (slotId, inputs) => {
          let state = createInitialBehaviorState(slotId);
          let prevCount = 0;
          for (const input of inputs) {
            state = applyStateTransitions(state, input);
            expect(state.trigger_count).toBeGreaterThanOrEqual(prevCount);
            prevCount = state.trigger_count;
          }
        }
      )
    );
  });

  it('Cooling always eventually returns to Pending given sufficient tick progression', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.array(
          fc.record({
            conditionMet: fc.boolean(),
            currentTick: fc.integer({ min: 0, max: 10_000 }),
            stickyMaxActivations: fc.constant(undefined),
            cooldownTicks: fc.integer({ min: 1, max: 10 }),
            delayTicks: fc.constant(undefined)
          }),
          { minLength: 1, maxLength: 30 }
        ),
        (slotId, inputs) => {
          let state = createInitialBehaviorState(slotId);
          // Find any cooling state we end up in, then verify it resolves
          for (const input of inputs) {
            state = applyStateTransitions(state, input);
          }
          if (state.status === 'Cooling' && state.cooldown_until_tick !== undefined) {
            // Push tick past cooldown — should go to Pending
            const resolve = applyStateTransitions(state, {
              conditionMet: true,
              currentTick: state.cooldown_until_tick + 1
            });
            expect(resolve.status).toBe('Pending');
          }
        }
      )
    );
  });

  it('Delayed always eventually becomes Active given sufficient tick progression', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.array(
          fc.record({
            conditionMet: fc.boolean(),
            currentTick: fc.integer({ min: 0, max: 5_000 }),
            stickyMaxActivations: fc.constant(undefined),
            cooldownTicks: fc.constant(undefined),
            delayTicks: fc.integer({ min: 1, max: 10 })
          }),
          { minLength: 1, maxLength: 20 }
        ),
        (slotId, inputs) => {
          let state = createInitialBehaviorState(slotId);
          for (const input of inputs) {
            state = applyStateTransitions(state, input);
          }
          if (state.status === 'Delayed' && state.delay_until_tick !== undefined) {
            const resolve = applyStateTransitions(state, {
              conditionMet: true,
              currentTick: state.delay_until_tick + 1
            });
            expect(resolve.status).toBe('Active');
          }
        }
      )
    );
  });
});
