import { describe, expect, it } from 'vitest';

import {
  buildStepContext,
  computeAdaptiveStep,
  computeVariableStep,
  type StepStrategy
} from '../../../src/core/step_strategy.js';
import { getWorldPackRuntimeConfig, parseTickToBigInt } from '../../../src/core/world_pack_runtime.js';

/* ──────────────────── parseTickToBigInt ──────────────────── */

describe('parseTickToBigInt', () => {
  it('returns undefined for undefined input', () => {
    expect(parseTickToBigInt(undefined, 'field')).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    expect(parseTickToBigInt(null as unknown as undefined, 'field')).toBeUndefined();
  });

  it('converts numeric string to bigint', () => {
    expect(parseTickToBigInt('42', 'field')).toBe(42n);
  });

  it('converts number to bigint', () => {
    expect(parseTickToBigInt(100, 'field')).toBe(100n);
  });

  it('converts bigint-like string', () => {
    expect(parseTickToBigInt('999999999999999', 'field')).toBe(999999999999999n);
  });

  it('returns undefined for non-numeric string', () => {
    expect(parseTickToBigInt('abc', 'field')).toBeUndefined();
  });

  it('handles empty string', () => {
    // BigInt('') returns 0n in JS
    expect(parseTickToBigInt('', 'field')).toBe(0n);
  });

  it('handles zero', () => {
    expect(parseTickToBigInt(0, 'field')).toBe(0n);
    expect(parseTickToBigInt('0', 'field')).toBe(0n);
  });

  it('handles negative values', () => {
    expect(parseTickToBigInt('-5', 'field')).toBe(-5n);
  });
});

/* ──────────────────── getWorldPackRuntimeConfig ──────────────────── */

describe('getWorldPackRuntimeConfig', () => {
  const minimalPack = {
    metadata: { id: 'test', name: 'Test', version: '1.0.0' }
  } as Parameters<typeof getWorldPackRuntimeConfig>[0];

  it('returns defaults for pack without simulation_time', () => {
    const config = getWorldPackRuntimeConfig(minimalPack);
    expect(config.initialTick).toBe(0n);
    expect(config.minTick).toBeUndefined();
    expect(config.maxTick).toBeUndefined();
    expect(config.stepStrategy).toBeUndefined();
  });

  it('parses initial_tick from simulation_time', () => {
    const pack = {
      ...minimalPack,
      simulation_time: { initial_tick: 100 }
    };
    const config = getWorldPackRuntimeConfig(pack);
    expect(config.initialTick).toBe(100n);
  });

  it('parses min_tick and max_tick', () => {
    const pack = {
      ...minimalPack,
      simulation_time: { min_tick: 0, max_tick: 10000 }
    };
    const config = getWorldPackRuntimeConfig(pack);
    expect(config.minTick).toBe(0n);
    expect(config.maxTick).toBe(10000n);
  });

  it('parses string tick values', () => {
    const pack = {
      ...minimalPack,
      simulation_time: { initial_tick: 'start', min_tick: '0', max_tick: '999' }
    };
    const config = getWorldPackRuntimeConfig(pack);
    expect(config.initialTick).toBe(0n); // 'start' is non-numeric, falls back to 0n
    expect(config.minTick).toBe(0n);
    expect(config.maxTick).toBe(999n);
  });

  it('builds step strategy for variable strategy', () => {
    const pack = {
      ...minimalPack,
      simulation_time: {
        step: {
          strategy: 'variable' as const,
          range: { min: 1, max: 10 },
          loop_interval_ms: 500
        }
      }
    };
    const config = getWorldPackRuntimeConfig(pack);
    expect(config.stepStrategy).toBeDefined();
    expect(config.stepStrategy?.kind).toBe('variable');
    expect(config.stepStrategy?.range.min).toBe(1n);
    expect(config.stepStrategy?.range.max).toBe(10n);
    expect(config.stepStrategy?.loopIntervalMs).toBe(500);
    expect(config.stepStrategy?.adaptive).toBeUndefined();
  });

  it('builds step strategy for adaptive strategy with adaptive config', () => {
    const pack = {
      ...minimalPack,
      simulation_time: {
        step: {
          strategy: 'adaptive' as const,
          range: { min: 1, max: 20 },
          adaptive: {
            target_loop_ms: 200,
            scale_up_threshold_ms: 100,
            scale_down_threshold_ms: 400
          }
        }
      }
    };
    const config = getWorldPackRuntimeConfig(pack);
    expect(config.stepStrategy?.kind).toBe('adaptive');
    expect(config.stepStrategy?.adaptive).toEqual({
      targetLoopMs: 200,
      scaleUpThresholdMs: 100,
      scaleDownThresholdMs: 400
    });
  });

  it('defaults loop_interval_ms to 1000 when not provided', () => {
    const pack = {
      ...minimalPack,
      simulation_time: {
        step: { strategy: 'variable' as const, range: { min: 1, max: 5 } }
      }
    };
    const config = getWorldPackRuntimeConfig(pack);
    expect(config.stepStrategy?.loopIntervalMs).toBe(1000);
  });
});

/* ──────────────────── buildStepContext ──────────────────── */

describe('buildStepContext', () => {
  it('creates step context from params', () => {
    const ctx = buildStepContext({
      currentTick: 42n,
      lastLoopDurationMs: 150,
      overlapSkippedCount: 3,
      pendingEventCount: 7
    });
    expect(ctx.currentTick).toBe(42n);
    expect(ctx.lastLoopDurationMs).toBe(150);
    expect(ctx.overlapSkippedCount).toBe(3);
    expect(ctx.pendingEventCount).toBe(7);
  });
});

/* ──────────────────── computeVariableStep ──────────────────── */

describe('computeVariableStep', () => {
  const strategy: StepStrategy = {
    kind: 'variable',
    range: { min: 1n, max: 10n },
    loopIntervalMs: 1000
  };
  const ctx = buildStepContext({
    currentTick: 0n,
    lastLoopDurationMs: 100,
    overlapSkippedCount: 0,
    pendingEventCount: 0
  });

  it('uses requested step when provided', () => {
    expect(computeVariableStep(strategy, ctx, 5n)).toBe(5n);
  });

  it('clamps requested step below min', () => {
    expect(computeVariableStep(strategy, ctx, 0n)).toBe(1n);
  });

  it('clamps requested step above max', () => {
    expect(computeVariableStep(strategy, ctx, 100n)).toBe(10n);
  });

  it('falls back to range.min when no requested step', () => {
    expect(computeVariableStep(strategy, ctx)).toBe(1n);
  });

  it('returns exact min boundary', () => {
    expect(computeVariableStep(strategy, ctx, 1n)).toBe(1n);
  });

  it('returns exact max boundary', () => {
    expect(computeVariableStep(strategy, ctx, 10n)).toBe(10n);
  });
});

/* ──────────────────── computeAdaptiveStep ──────────────────── */

describe('computeAdaptiveStep', () => {
  const strategy: StepStrategy = {
    kind: 'adaptive',
    range: { min: 1n, max: 20n },
    loopIntervalMs: 1000,
    adaptive: {
      targetLoopMs: 200,
      scaleUpThresholdMs: 100,
      scaleDownThresholdMs: 400
    }
  };

  it('falls back to previous step clamped when no adaptive config', () => {
    const noAdaptive: StepStrategy = { kind: 'adaptive', range: { min: 1n, max: 10n }, loopIntervalMs: 1000 };
    const ctx = buildStepContext({ currentTick: 0n, lastLoopDurationMs: 50, overlapSkippedCount: 0, pendingEventCount: 0 });
    expect(computeAdaptiveStep(noAdaptive, ctx, 5n)).toBe(5n);
  });

  it('reduces step when overlap detected (previous > 1)', () => {
    const ctx = buildStepContext({ currentTick: 0n, lastLoopDurationMs: 50, overlapSkippedCount: 2, pendingEventCount: 0 });
    const result = computeAdaptiveStep(strategy, ctx, 5n);
    expect(result).toBe(4n); // 5n - 1n
  });

  it('halves step when overlap detected and previous is 1', () => {
    const ctx = buildStepContext({ currentTick: 0n, lastLoopDurationMs: 50, overlapSkippedCount: 1, pendingEventCount: 0 });
    const result = computeAdaptiveStep(strategy, ctx, 1n);
    // 1n - 1n = 0n which is > 0n? no → use 1n / 2n = 0n, clamped to min 1n
    expect(result).toBe(1n);
  });

  it('scales up when loop duration < scaleUpThreshold', () => {
    const ctx = buildStepContext({ currentTick: 0n, lastLoopDurationMs: 50, overlapSkippedCount: 0, pendingEventCount: 0 });
    const result = computeAdaptiveStep(strategy, ctx, 5n);
    expect(result).toBe(6n); // 5n + 1n
  });

  it('scales down when loop duration > scaleDownThreshold', () => {
    const ctx = buildStepContext({ currentTick: 0n, lastLoopDurationMs: 500, overlapSkippedCount: 0, pendingEventCount: 0 });
    const result = computeAdaptiveStep(strategy, ctx, 5n);
    expect(result).toBe(4n); // 5n - 1n
  });

  it('keeps step unchanged when in normal range', () => {
    const ctx = buildStepContext({ currentTick: 0n, lastLoopDurationMs: 200, overlapSkippedCount: 0, pendingEventCount: 0 });
    const result = computeAdaptiveStep(strategy, ctx, 5n);
    expect(result).toBe(5n);
  });

  it('clamps at max when scaling up', () => {
    const ctx = buildStepContext({ currentTick: 0n, lastLoopDurationMs: 50, overlapSkippedCount: 0, pendingEventCount: 0 });
    const result = computeAdaptiveStep(strategy, ctx, 20n);
    expect(result).toBe(20n); // clamped at max
  });

  it('clamps at min when scaling down', () => {
    const ctx = buildStepContext({ currentTick: 0n, lastLoopDurationMs: 500, overlapSkippedCount: 0, pendingEventCount: 0 });
    const result = computeAdaptiveStep(strategy, ctx, 1n);
    expect(result).toBe(1n); // clamped at min
  });

  it('overlap takes priority over duration-based scaling', () => {
    const ctx = buildStepContext({ currentTick: 0n, lastLoopDurationMs: 50, overlapSkippedCount: 1, pendingEventCount: 0 });
    // overlap detected → reduce, even though duration would suggest scale up
    const result = computeAdaptiveStep(strategy, ctx, 10n);
    expect(result).toBe(9n);
  });
});
