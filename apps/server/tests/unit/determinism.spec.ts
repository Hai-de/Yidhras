import { describe, expect, it } from 'vitest';

import {
  computeStateDigest,
  createDefaultPackSeed,
  createDeterminismContext,
  createDeterministicRandom,
  deriveSeed,
  DETERMINISM_MODES,
  normalizeBaseSeed,
  normalizeForStableJson,
  stableJsonStringify
} from '../../src/determinism/index.js';
import type { PrismaStateSnapshot } from '../../src/determinism/state_digest.js';

// ── PRNG ──────────────────────────────────────────────────────────

describe('createDeterministicRandom', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createDeterministicRandom('test-seed');
    const b = createDeterministicRandom('test-seed');

    for (let i = 0; i < 20; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = createDeterministicRandom('alpha');
    const b = createDeterministicRandom('beta');

    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('nextFloat returns values in [0, 1)', () => {
    const rng = createDeterministicRandom('float-test');
    for (let i = 0; i < 200; i++) {
      const v = rng.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt returns values in [min, max]', () => {
    const rng = createDeterministicRandom('int-test');
    for (let i = 0; i < 200; i++) {
      const v = rng.nextInt(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(10);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('nextInt returns min when min equals max', () => {
    const rng = createDeterministicRandom('single');
    expect(rng.nextInt(7, 7)).toBe(7);
  });

  it('nextInt throws when max < min', () => {
    const rng = createDeterministicRandom('err');
    expect(() => rng.nextInt(10, 5)).toThrow('[determinism/prng]');
  });

  it('nextInt throws on non-integer bounds', () => {
    const rng = createDeterministicRandom('err');
    expect(() => rng.nextInt(1.5, 10)).toThrow('[determinism/prng]');
    expect(() => rng.nextInt(1, 10.5)).toThrow('[determinism/prng]');
  });

  it('nextBoolean with default probability', () => {
    const rng = createDeterministicRandom('bool-0.5');
    const results = Array.from({ length: 100 }, () => rng.nextBoolean());
    const trues = results.filter(Boolean).length;
    // With a fixed seed it's deterministic; we just check range
    expect(trues).toBeGreaterThan(0);
    expect(trues).toBeLessThan(100);
  });

  it('nextBoolean with probability 0 always returns false', () => {
    const rng = createDeterministicRandom('bool-0');
    for (let i = 0; i < 50; i++) {
      expect(rng.nextBoolean(0)).toBe(false);
    }
  });

  it('nextBoolean with probability 1 always returns true', () => {
    const rng = createDeterministicRandom('bool-1');
    for (let i = 0; i < 50; i++) {
      expect(rng.nextBoolean(1)).toBe(true);
    }
  });

  it('nextBoolean throws on out-of-range probability', () => {
    const rng = createDeterministicRandom('err');
    expect(() => rng.nextBoolean(-0.1)).toThrow('[determinism/prng]');
    expect(() => rng.nextBoolean(1.1)).toThrow('[determinism/prng]');
    expect(() => rng.nextBoolean(NaN)).toThrow('[determinism/prng]');
    expect(() => rng.nextBoolean(Infinity)).toThrow('[determinism/prng]');
  });

  it('nextId produces deterministic ids with prefix', () => {
    const a = createDeterministicRandom('id-test');
    const b = createDeterministicRandom('id-test');
    expect(a.nextId('evt')).toBe(b.nextId('evt'));
    expect(a.nextId('act', 4)).toBe(b.nextId('act', 4));
  });

  it('nextId throws on non-positive bytes', () => {
    const rng = createDeterministicRandom('err');
    expect(() => rng.nextId('x', 0)).toThrow('[determinism/prng]');
    expect(() => rng.nextId('x', -1)).toThrow('[determinism/prng]');
  });

  it('pick selects deterministic items', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const a = createDeterministicRandom('pick-test');
    const b = createDeterministicRandom('pick-test');
    for (let i = 0; i < 10; i++) {
      expect(a.pick(items)).toBe(b.pick(items));
    }
  });

  it('pick throws on empty array', () => {
    const rng = createDeterministicRandom('err');
    expect(() => rng.pick([])).toThrow('[determinism/prng]');
  });

  it('getSeed returns the seed', () => {
    const rng = createDeterministicRandom('my-seed');
    expect(rng.getSeed()).toBe('my-seed');
  });

  it('empty seed is handled gracefully', () => {
    const rng = createDeterministicRandom('');
    expect(rng.getSeed()).toBe('<empty-seed>');
    expect(rng.nextFloat()).toBeGreaterThanOrEqual(0);
  });
});

// ── Seed derivation ───────────────────────────────────────────────

describe('deriveSeed', () => {
  it('same base + parts produce same derived seed', () => {
    const a = deriveSeed('base', 'a', 1, true);
    const b = deriveSeed('base', 'a', 1, true);
    expect(a).toBe(b);
  });

  it('different parts produce different derived seeds', () => {
    const a = deriveSeed('base', 'a');
    const b = deriveSeed('base', 'b');
    expect(a).not.toBe(b);
  });

  it('different base produces different derived seeds', () => {
    const a = deriveSeed('base1', 'x');
    const b = deriveSeed('base2', 'x');
    expect(a).not.toBe(b);
  });

  it('handles null and undefined parts stably', () => {
    const a = deriveSeed('base', null, undefined);
    const b = deriveSeed('base', null, undefined);
    expect(a).toBe(b);
  });

  it('handles bigint parts stably', () => {
    const a = deriveSeed('base', BigInt(42));
    const b = deriveSeed('base', BigInt(42));
    expect(a).toBe(b);
  });

  it('order of parts matters', () => {
    const a = deriveSeed('base', 1, 2);
    const b = deriveSeed('base', 2, 1);
    expect(a).not.toBe(b);
  });

  it('derived seed starts with base seed prefix', () => {
    const result = deriveSeed('mybase', 'x');
    expect(result.startsWith('mybase#')).toBe(true);
  });
});

describe('normalizeBaseSeed', () => {
  it('returns trimmed seed when non-empty', () => {
    expect(normalizeBaseSeed('  hello  ', 'fallback')).toBe('hello');
  });

  it('returns fallback when seed is empty', () => {
    expect(normalizeBaseSeed('', 'fallback')).toBe('fallback');
    expect(normalizeBaseSeed(null, 'fallback')).toBe('fallback');
    expect(normalizeBaseSeed(undefined, 'fallback')).toBe('fallback');
  });
});

describe('createDefaultPackSeed', () => {
  it('returns pack: prefix with pack id', () => {
    expect(createDefaultPackSeed('cyberpunk-2077')).toBe('pack:cyberpunk-2077');
  });
});

// ── DeterminismContext ────────────────────────────────────────────

describe('DeterminismContext', () => {
  it('creates context with required fields', () => {
    const ctx = createDeterminismContext({ packId: 'test-pack', baseSeed: 'seed-1' });
    expect(ctx.packId).toBe('test-pack');
    expect(ctx.baseSeed).toBe('seed-1');
    expect(ctx.mode).toBe('off');
  });

  it('accepts explicit mode', () => {
    const ctx = createDeterminismContext({ packId: 'p', baseSeed: 's', mode: 'strict' });
    expect(ctx.mode).toBe('strict');
  });

  it('DETERMINISM_MODES contains all valid modes', () => {
    expect(DETERMINISM_MODES).toEqual(['off', 'record', 'replay', 'strict']);
  });

  it('forTick produces different seed than base', () => {
    const ctx = createDeterminismContext({ packId: 'p', baseSeed: 's' });
    const tickCtx = ctx.forTick(42);
    expect(tickCtx.getSeed()).not.toBe(ctx.getSeed());
  });

  it('forTick with same tick produces same derived seed', () => {
    const a = createDeterminismContext({ packId: 'p', baseSeed: 's' }).forTick(1);
    const b = createDeterminismContext({ packId: 'p', baseSeed: 's' }).forTick(1);
    expect(a.getSeed()).toBe(b.getSeed());
  });

  it('forTick with different ticks produce different seeds', () => {
    const ctx = createDeterminismContext({ packId: 'p', baseSeed: 's' });
    expect(ctx.forTick(1).getSeed()).not.toBe(ctx.forTick(2).getSeed());
  });

  it('forStep produces different seed for different steps', () => {
    const ctx = createDeterminismContext({ packId: 'p', baseSeed: 's' });
    expect(ctx.forStep(1).getSeed()).not.toBe(ctx.forStep(2).getSeed());
  });

  it('forSubsystem produces different seed for different subsystems', () => {
    const ctx = createDeterminismContext({ packId: 'p', baseSeed: 's' });
    expect(ctx.forSubsystem('perception').getSeed()).not.toBe(ctx.forSubsystem('action').getSeed());
  });

  it('forPurpose produces deterministic seed with stable key', () => {
    const a = createDeterminismContext({ packId: 'p', baseSeed: 's' }).forPurpose('drop', 'intent-1');
    const b = createDeterminismContext({ packId: 'p', baseSeed: 's' }).forPurpose('drop', 'intent-1');
    expect(a.getSeed()).toBe(b.getSeed());
  });

  it('forPurpose with different keys produces different seeds', () => {
    const ctx = createDeterminismContext({ packId: 'p', baseSeed: 's' });
    expect(
      ctx.forPurpose('drop', 'intent-1').getSeed()
    ).not.toBe(
      ctx.forPurpose('drop', 'intent-2').getSeed()
    );
  });

  it('chained derivations are deterministic', () => {
    const make = () =>
      createDeterminismContext({ packId: 'p', baseSeed: 's' })
        .forTick(5)
        .forSubsystem('actions')
        .forPurpose('drop', 'intent-x');

    expect(make().getSeed()).toBe(make().getSeed());
    expect(make().random().nextFloat()).toBe(make().random().nextFloat());
  });

  it('random() returns a DeterministicRandom anchored to derived seed', () => {
    const ctx = createDeterminismContext({ packId: 'p', baseSeed: 's' }).forTick(1);
    const rng = ctx.random();
    expect(rng.nextFloat()).toBeGreaterThanOrEqual(0);
    expect(rng.nextFloat()).toBeLessThan(1);
  });

  it('describe() returns context metadata', () => {
    const ctx = createDeterminismContext({ packId: 'p', baseSeed: 's' });
    const desc = ctx.describe();
    expect(desc.packId).toBe('p');
    expect(desc.baseSeed).toBe('s');
    expect(desc.mode).toBe('off');
  });
});

// ── Stable JSON ───────────────────────────────────────────────────

describe('normalizeForStableJson', () => {
  it('returns null for null and undefined', () => {
    expect(normalizeForStableJson(null)).toBeNull();
    expect(normalizeForStableJson(undefined)).toBeNull();
  });

  it('passes through strings and booleans', () => {
    expect(normalizeForStableJson('hello')).toBe('hello');
    expect(normalizeForStableJson(true)).toBe(true);
    expect(normalizeForStableJson(false)).toBe(false);
  });

  it('normalizes -0 to 0', () => {
    const result = normalizeForStableJson(-0);
    expect(Object.is(result, -0)).toBe(false);
    expect(result).toBe(0);
  });

  it('normalizes NaN and Infinity to strings', () => {
    expect(normalizeForStableJson(NaN)).toBe('NaN');
    expect(normalizeForStableJson(Infinity)).toBe('Infinity');
    expect(normalizeForStableJson(-Infinity)).toBe('-Infinity');
  });

  it('normalizes bigint to string', () => {
    expect(normalizeForStableJson(BigInt(42))).toBe('42');
  });

  it('normalizes Date to ISO string', () => {
    const d = new Date('2025-01-15T12:00:00.000Z');
    expect(normalizeForStableJson(d)).toBe('2025-01-15T12:00:00.000Z');
  });

  it('sorts object keys alphabetically', () => {
    const input = { zebra: 1, apple: 2, mango: 3 };
    const result = stableJsonStringify(input);
    expect(result).toBe('{"apple":2,"mango":3,"zebra":1}');
  });

  it('recursively sorts nested object keys', () => {
    const input = { b: { d: 4, c: 3 }, a: 1 };
    const result = stableJsonStringify(input);
    expect(result).toBe('{"a":1,"b":{"c":3,"d":4}}');
  });

  it('ignores specified keys', () => {
    const input = { id: 'x', updated_at_ms: 12345, name: 'test' };
    const result = stableJsonStringify(input, { ignoredKeys: ['updated_at_ms'] });
    expect(result).toBe('{"id":"x","name":"test"}');
  });

  it('ignores specified keys recursively', () => {
    const input = { data: { value: 1, updated_at_ms: 999 }, id: 'x', updated_at_ms: 12345 };
    const result = stableJsonStringify(input, { ignoredKeys: ['updated_at_ms'] });
    expect(result).toBe('{"data":{"value":1},"id":"x"}');
  });

  it('handles arrays', () => {
    const input = { items: [3, 1, 2] };
    const result = stableJsonStringify(input);
    expect(result).toBe('{"items":[3,1,2]}');
  });

  it('handles nested arrays of objects', () => {
    const input = [{ b: 2, a: 1 }, { d: 4, c: 3 }];
    const result = stableJsonStringify(input);
    expect(result).toBe('[{"a":1,"b":2},{"c":3,"d":4}]');
  });

  it('same logical object with different key order produces same JSON', () => {
    // Using JSON.parse to create objects with different insertion order
    const a = JSON.parse('{"b":1,"a":2}');
    const b = JSON.parse('{"a":2,"b":1}');
    expect(stableJsonStringify(a)).toBe(stableJsonStringify(b));
  });

  it('handles unknown types', () => {
    expect(normalizeForStableJson(Symbol('test'))).toBe('[unstable:symbol]');
  });

  it('handles empty object', () => {
    expect(stableJsonStringify({})).toBe('{}');
  });

  it('handles empty array', () => {
    expect(stableJsonStringify([])).toBe('[]');
  });
});

// ── State Digest ──────────────────────────────────────────────────

const makeEmptyPrismaData = (): PrismaStateSnapshot => ({
  agents: [],
  identities: [],
  identity_node_bindings: [],
  posts: [],
  relationships: [],
  memory_blocks: [],
  context_overlay_entries: [],
  memory_compaction_states: [],
  scenario_entity_states: []
});

describe('computeStateDigest', () => {
  it('produces a sha256 hex string for empty state', () => {
    const result = computeStateDigest('pack-test', '0', '0', makeEmptyPrismaData());
    expect(result.packId).toBe('pack-test');
    expect(result.tick).toBe('0');
    expect(result.revision).toBe('0');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof result.canonicalJson).toBe('string');
  });

  it('same data produces same digest', () => {
    const data = makeEmptyPrismaData();
    const a = computeStateDigest('p', '1', '1', data);
    const b = computeStateDigest('p', '1', '1', data);
    expect(a.sha256).toBe(b.sha256);
    expect(a.canonicalJson).toBe(b.canonicalJson);
  });

  it('different tick produces different digest', () => {
    const data = makeEmptyPrismaData();
    const a = computeStateDigest('p', '1', '1', data);
    const b = computeStateDigest('p', '2', '1', data);
    expect(a.sha256).not.toBe(b.sha256);
  });

  it('different revision produces different digest', () => {
    const data = makeEmptyPrismaData();
    const a = computeStateDigest('p', '1', '1', data);
    const b = computeStateDigest('p', '1', '2', data);
    expect(a.sha256).not.toBe(b.sha256);
  });

  it('different pack id produces different digest', () => {
    const data = makeEmptyPrismaData();
    const a = computeStateDigest('pack-a', '1', '1', data);
    const b = computeStateDigest('pack-b', '1', '1', data);
    expect(a.sha256).not.toBe(b.sha256);
  });

  it('agent state change alters digest', () => {
    const base = makeEmptyPrismaData();
    const a = computeStateDigest('p', '1', '1', base);
    const b = computeStateDigest('p', '1', '1', {
      ...base,
      agents: [{ id: 'agent-1', name: 'Test', snr: 50 }]
    });
    expect(a.sha256).not.toBe(b.sha256);
  });

  it('records are sorted by primary key in canonical JSON', () => {
    const data: PrismaStateSnapshot = {
      ...makeEmptyPrismaData(),
      agents: [
        { id: 'c', name: 'Third' },
        { id: 'a', name: 'First' },
        { id: 'b', name: 'Second' }
      ]
    };
    const result = computeStateDigest('p', '1', '1', data);
    const parsed = JSON.parse(result.canonicalJson);
    const agentIds = (parsed.prisma.agents as Array<{ id: string }>).map((a) => a.id);
    expect(agentIds).toEqual(['a', 'b', 'c']);
  });

  it('ignores non-deterministic fields from digest', () => {
    const data: PrismaStateSnapshot = {
      ...makeEmptyPrismaData(),
      agents: [{ id: 'a', updated_at_ms: 99999, name: 'Test' }]
    };
    const result = computeStateDigest('p', '1', '1', data);

    const data2: PrismaStateSnapshot = {
      ...makeEmptyPrismaData(),
      agents: [{ id: 'a', updated_at_ms: 11111, name: 'Test' }]
    };
    const result2 = computeStateDigest('p', '1', '1', data2);

    // Different updated_at_ms should still produce same digest (ignored field)
    expect(result.sha256).toBe(result2.sha256);
  });

  it('includes engine owned data when provided', () => {
    const a = computeStateDigest('p', '1', '1', makeEmptyPrismaData(), {
      world_entities: [],
      entity_states: [],
      authority_grants: [],
      mediator_bindings: [],
      rule_execution_records: []
    });
    const b = computeStateDigest('p', '1', '1', makeEmptyPrismaData());
    // Engine owned data contributes to digest
    expect(a.sha256).not.toBe(b.sha256);
  });

  it('engine owned data sorted by primary key', () => {
    const a = computeStateDigest('p', '1', '1', makeEmptyPrismaData(), {
      world_entities: [{ entity_id: 'z' }, { entity_id: 'a' }],
      entity_states: [],
      authority_grants: [],
      mediator_bindings: [],
      rule_execution_records: []
    });
    const b = computeStateDigest('p', '1', '1', makeEmptyPrismaData(), {
      world_entities: [{ entity_id: 'a' }, { entity_id: 'z' }],
      entity_states: [],
      authority_grants: [],
      mediator_bindings: [],
      rule_execution_records: []
    });
    // Same entities in different input order → same digest
    expect(a.sha256).toBe(b.sha256);
  });
});
