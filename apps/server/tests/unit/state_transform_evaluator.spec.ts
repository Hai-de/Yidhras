import { describe, expect, it, vi } from 'vitest';

import { parseWorldPackConstitution } from '../../src/packs/manifest/constitution_loader.js';
import { evaluateStateTransforms } from '../../src/packs/runtime/state_transform_evaluator.js';

const noopLogger = {
  logDebug: vi.fn(),
  logWarn: vi.fn()
};

const createActorState = (entityId: string, stateJson: Record<string, unknown>) => ({
  entity_id: entityId,
  state_json: stateJson
});

const publicOpinionTransform = {
  source: 'public_opinion',
  ranges: [
    { min: 0, max: 30, label: 'low' },
    { min: 31, max: 70, label: 'medium' },
    { min: 71, max: 100, label: 'high' }
  ],
  target: 'public_opinion_stage'
};

describe('evaluateStateTransforms', () => {
  it('returns empty array when no actor states provided', () => {
    const ops = evaluateStateTransforms({
      packId: 'test-pack',
      actorStates: [],
      transformDefs: [publicOpinionTransform],
      ...noopLogger
    });
    expect(ops).toEqual([]);
  });

  it('returns empty array when no transform defs provided', () => {
    const ops = evaluateStateTransforms({
      packId: 'test-pack',
      actorStates: [createActorState('actor-1', { public_opinion: 50 })],
      transformDefs: [],
      ...noopLogger
    });
    expect(ops).toEqual([]);
  });

  it('maps value to correct range label', () => {
    const ops = evaluateStateTransforms({
      packId: 'test-pack',
      actorStates: [createActorState('actor-1', { public_opinion: 50 })],
      transformDefs: [publicOpinionTransform],
      ...noopLogger
    });

    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('upsert_entity_state');
    expect(ops[0].target_ref).toBe('actor-1');
    expect(ops[0].namespace).toBe('core');
    const next = ops[0].payload.next as Record<string, unknown>;
    expect(next.public_opinion).toBe(50); // original key preserved
    expect(next.public_opinion_stage).toBe('medium');
  });

  it('preserves existing state keys in merged result', () => {
    const ops = evaluateStateTransforms({
      packId: 'test-pack',
      actorStates: [createActorState('actor-1', { hp: 100, public_opinion: 15, name: 'Test' })],
      transformDefs: [publicOpinionTransform],
      ...noopLogger
    });

    expect(ops).toHaveLength(1);
    const next = ops[0].payload.next as Record<string, unknown>;
    expect(next.hp).toBe(100);
    expect(next.name).toBe('Test');
    expect(next.public_opinion).toBe(15);
    expect(next.public_opinion_stage).toBe('low');
  });

  it('range boundary: min value matches', () => {
    const ops = evaluateStateTransforms({
      packId: 'test-pack',
      actorStates: [createActorState('actor-1', { public_opinion: 0 })],
      transformDefs: [publicOpinionTransform],
      ...noopLogger
    });
    expect(ops).toHaveLength(1);
    const next = ops[0].payload.next as Record<string, unknown>;
    expect(next.public_opinion_stage).toBe('low');
  });

  it('range boundary: max value matches', () => {
    const ops = evaluateStateTransforms({
      packId: 'test-pack',
      actorStates: [createActorState('actor-1', { public_opinion: 100 })],
      transformDefs: [publicOpinionTransform],
      ...noopLogger
    });
    expect(ops).toHaveLength(1);
    const next = ops[0].payload.next as Record<string, unknown>;
    expect(next.public_opinion_stage).toBe('high');
  });

  it('skips when source value is missing', () => {
    const logDebug = vi.fn();
    const ops = evaluateStateTransforms({
      packId: 'test-pack',
      actorStates: [createActorState('actor-1', { hp: 100 })],
      transformDefs: [publicOpinionTransform],
      logDebug,
      logWarn: vi.fn()
    });

    expect(ops).toEqual([]);
    expect(logDebug).toHaveBeenCalledWith(
      expect.stringContaining('state_transform source key not found'),
      expect.objectContaining({ source: 'public_opinion', entity_id: 'actor-1' })
    );
  });

  it('skips when source value is not a number', () => {
    const logDebug = vi.fn();
    const ops = evaluateStateTransforms({
      packId: 'test-pack',
      actorStates: [createActorState('actor-1', { public_opinion: 'high' })],
      transformDefs: [publicOpinionTransform],
      logDebug,
      logWarn: vi.fn()
    });

    expect(ops).toEqual([]);
    expect(logDebug).toHaveBeenCalledWith(
      expect.stringContaining('not a number'),
      expect.objectContaining({ actual_type: 'string' })
    );
  });

  it('skips source value null', () => {
    const logDebug = vi.fn();
    const ops = evaluateStateTransforms({
      packId: 'test-pack',
      actorStates: [createActorState('actor-1', { public_opinion: null })],
      transformDefs: [publicOpinionTransform],
      logDebug,
      logWarn: vi.fn()
    });

    expect(ops).toEqual([]);
    expect(logDebug).toHaveBeenCalledWith(
      expect.stringContaining('source key not found'),
      expect.anything()
    );
  });

  it('warns when value outside all ranges', () => {
    const logWarn = vi.fn();
    const ops = evaluateStateTransforms({
      packId: 'test-pack',
      actorStates: [createActorState('actor-1', { public_opinion: 999 })],
      transformDefs: [publicOpinionTransform],
      logDebug: vi.fn(),
      logWarn
    });

    expect(ops).toEqual([]);
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('outside all ranges'),
      expect.objectContaining({ value: 999 })
    );
  });

  it('skips when value falls in a gap between ranges', () => {
    const logWarn = vi.fn();
    const gappedTransform = {
      source: 'score',
      ranges: [
        { min: 0, max: 30, label: 'low' },
        { min: 50, max: 100, label: 'high' }
      ],
      target: 'score_stage'
    };

    const ops = evaluateStateTransforms({
      packId: 'test-pack',
      actorStates: [createActorState('actor-1', { score: 40 })],
      transformDefs: [gappedTransform],
      logDebug: vi.fn(),
      logWarn
    });

    expect(ops).toEqual([]);
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('outside all ranges'),
      expect.objectContaining({ value: 40 })
    );
  });

  it('applies multiple transforms to one actor', () => {
    const hpTransform = {
      source: 'hp_pct',
      ranges: [
        { min: 0, max: 25, label: 'critical' },
        { min: 26, max: 100, label: 'healthy' }
      ],
      target: 'hp_stage'
    };

    const ops = evaluateStateTransforms({
      packId: 'test-pack',
      actorStates: [createActorState('actor-1', { public_opinion: 80, hp_pct: 10 })],
      transformDefs: [publicOpinionTransform, hpTransform],
      ...noopLogger
    });

    expect(ops).toHaveLength(1);
    const next = ops[0].payload.next as Record<string, unknown>;
    expect(next.public_opinion_stage).toBe('high');
    expect(next.hp_stage).toBe('critical');
  });

  it('applies transform to multiple actors independently', () => {
    const ops = evaluateStateTransforms({
      packId: 'test-pack',
      actorStates: [
        createActorState('actor-1', { public_opinion: 85 }),
        createActorState('actor-2', { public_opinion: 20 })
      ],
      transformDefs: [publicOpinionTransform],
      ...noopLogger
    });

    expect(ops).toHaveLength(2);
    const op1 = ops.find(o => o.target_ref === 'actor-1')!;
    const op2 = ops.find(o => o.target_ref === 'actor-2')!;
    expect((op1.payload.next as Record<string, unknown>).public_opinion_stage).toBe('high');
    expect((op2.payload.next as Record<string, unknown>).public_opinion_stage).toBe('low');
  });

  it('actor with no matching source key produces no delta for that actor', () => {
    const ops = evaluateStateTransforms({
      packId: 'test-pack',
      actorStates: [
        createActorState('actor-1', { public_opinion: 50 }),
        createActorState('actor-2', { unrelated: true })
      ],
      transformDefs: [publicOpinionTransform],
      ...noopLogger
    });

    expect(ops).toHaveLength(1);
    expect(ops[0].target_ref).toBe('actor-1');
  });

  it('second transform overwrites target from first if same target key (validated at schema level)', () => {
    const t1 = { source: 'a', ranges: [{ min: 0, max: 10, label: 'x' }], target: 'result' };
    const t2 = { source: 'b', ranges: [{ min: 0, max: 10, label: 'y' }], target: 'result' };

    const ops = evaluateStateTransforms({
      packId: 'test-pack',
      actorStates: [createActorState('actor-1', { a: 5, b: 5 })],
      transformDefs: [t1, t2],
      ...noopLogger
    });

    expect(ops).toHaveLength(1);
    const next = ops[0].payload.next as Record<string, unknown>;
    // t2 runs second, its label wins
    expect(next.result).toBe('y');
  });

  it('previous state_json is recorded in payload for observability', () => {
    const ops = evaluateStateTransforms({
      packId: 'test-pack',
      actorStates: [createActorState('actor-1', { public_opinion: 50, other: 'keep' })],
      transformDefs: [publicOpinionTransform],
      ...noopLogger
    });

    const previous = ops[0].payload.previous as Record<string, unknown>;
    expect(previous.public_opinion).toBe(50);
    expect(previous.other).toBe('keep');
    expect(previous.public_opinion_stage).toBeUndefined();
  });
});

describe('worldPackConstitutionSchema — state_transforms validation', () => {
  const basePack = {
    metadata: { id: 'test-pack', name: 'Test Pack', version: '1.0.0', author: 'test' }
  };

  it('rejects duplicate target keys across transforms', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...basePack,
        state_transforms: [
          { source: 'a', ranges: [{ min: 0, max: 10, label: 'x' }], target: 'result' },
          { source: 'b', ranges: [{ min: 0, max: 10, label: 'y' }], target: 'result' }
        ]
      })
    ).toThrow('Duplicate state_transform target "result"');
  });

  it('accepts unique target keys across transforms', () => {
    const pack = parseWorldPackConstitution({
      ...basePack,
      state_transforms: [
        { source: 'a', ranges: [{ min: 0, max: 10, label: 'x' }], target: 'result_a' },
        { source: 'b', ranges: [{ min: 0, max: 10, label: 'y' }], target: 'result_b' }
      ]
    });
    expect(pack.state_transforms).toHaveLength(2);
  });

  it('accepts single transform', () => {
    const pack = parseWorldPackConstitution({
      ...basePack,
      state_transforms: [
        { source: 'score', ranges: [{ min: 0, max: 50, label: 'half' }], target: 'stage' }
      ]
    });
    expect(pack.state_transforms).toHaveLength(1);
  });
});
