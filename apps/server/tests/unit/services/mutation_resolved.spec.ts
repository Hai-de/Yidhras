import { describe, expect, it } from 'vitest';

import { buildMutationResolvedResult } from '../../../src/app/services/mutation/mutation_resolved.js';

describe('buildMutationResolvedResult', () => {
  const baseInput = {
    action_intent_id: 'intent-123',
    operation: 'adjust_relationship',
    reason: 'test reason',
    target: { entity_id: 'entity-1' },
    requested: { affinity: 0.8 },
    baseline: { affinity: 0.5 },
    absolute: { affinity: 0.8 }
  };

  it('builds result with correct structure', () => {
    const result = buildMutationResolvedResult(baseInput);

    expect(result).toEqual({
      intent: {
        action_intent_id: 'intent-123',
        operation: 'adjust_relationship',
        reason: 'test reason',
        target: { entity_id: 'entity-1' },
        requested: { affinity: 0.8 }
      },
      baseline: { affinity: 0.5 },
      result: {
        absolute: { affinity: 0.8 }
      }
    });
  });

  it('preserves null reason', () => {
    const result = buildMutationResolvedResult({
      ...baseInput,
      reason: null
    });

    expect(result.intent.reason).toBeNull();
  });

  it('preserves complex nested objects', () => {
    const complexTarget = {
      entity_id: 'entity-1',
      nested: { deep: { value: true } }
    };
    const result = buildMutationResolvedResult({
      ...baseInput,
      target: complexTarget
    });

    expect(result.intent.target).toEqual(complexTarget);
  });

  it('separates baseline from result.absolute', () => {
    const result = buildMutationResolvedResult(baseInput);

    expect(result.baseline).toEqual({ affinity: 0.5 });
    expect(result.result.absolute).toEqual({ affinity: 0.8 });
    expect(result.baseline).not.toBe(result.result.absolute);
  });

  it('preserves all intent fields', () => {
    const result = buildMutationResolvedResult(baseInput);

    expect(Object.keys(result.intent)).toEqual([
      'action_intent_id',
      'operation',
      'reason',
      'target',
      'requested'
    ]);
  });
});
