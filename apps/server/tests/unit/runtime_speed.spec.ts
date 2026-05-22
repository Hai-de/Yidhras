import { describe, expect, it } from 'vitest';

import { RuntimeSpeedPolicy } from '../../src/core/runtime_speed.js';
import type { StepContext, StepStrategy } from '../../src/core/step_strategy.js';
import { buildStepContext } from '../../src/core/step_strategy.js';

function makeCtx(overrides?: Partial<StepContext>): StepContext {
  return buildStepContext({
    currentTick: 1000n,
    lastLoopDurationMs: 200,
    overlapSkippedCount: 0,
    pendingEventCount: 0,
    ...overrides
  });
}

const variableStrategy: StepStrategy = {
  kind: 'variable',
  range: { min: 1n, max: 10n },
  loopIntervalMs: 1000
};

const adaptiveStrategy: StepStrategy = {
  kind: 'adaptive',
  range: { min: 1n, max: 20n },
  loopIntervalMs: 500,
  adaptive: {
    targetLoopMs: 500,
    scaleUpThresholdMs: 300,
    scaleDownThresholdMs: 800
  }
};

describe('RuntimeSpeedPolicy ', () => {
  describe('variable mode', () => {
    it('returns requestedStep when within range', () => {
      const policy = new RuntimeSpeedPolicy(variableStrategy);
      const result = policy.getEffectiveStepTicks(makeCtx(), 5n);
      expect(result).toBe(5n);
    });

    it('clamps to range.max when requestedStep exceeds max', () => {
      const policy = new RuntimeSpeedPolicy(variableStrategy);
      const result = policy.getEffectiveStepTicks(makeCtx(), 100n);
      expect(result).toBe(10n);
    });

    it('clamps to range.min when requestedStep below min', () => {
      const policy = new RuntimeSpeedPolicy(variableStrategy);
      const result = policy.getEffectiveStepTicks(makeCtx(), 0n);
      expect(result).toBe(1n);
    });

    it('defaults to range.min when no requestedStep', () => {
      const policy = new RuntimeSpeedPolicy(variableStrategy);
      const result = policy.getEffectiveStepTicks(makeCtx());
      expect(result).toBe(1n);
    });
  });

  describe('adaptive mode', () => {
    it('increases step when loop duration is below scaleUpThreshold', () => {
      const policy = new RuntimeSpeedPolicy(adaptiveStrategy);
      const ctx = makeCtx({ lastLoopDurationMs: 100 }); // 100 < 300
      const result = policy.getEffectiveStepTicks(ctx);
      expect(result).toBe(2n); // min=1, +1
    });

    it('decreases step when loop duration is above scaleDownThreshold', () => {
      const policy = new RuntimeSpeedPolicy({ ...adaptiveStrategy, range: { min: 2n, max: 20n } });
      // First bump it up: 2 → 3 → 4
      policy.getEffectiveStepTicks(makeCtx({ lastLoopDurationMs: 100 }));
      policy.getEffectiveStepTicks(makeCtx({ lastLoopDurationMs: 100 }));
      // Now slow: 4 → 3
      const result = policy.getEffectiveStepTicks(makeCtx({ lastLoopDurationMs: 900 }));
      expect(result).toBe(3n);
    });

    it('clamps to range.max on continuous scale up', () => {
      const policy = new RuntimeSpeedPolicy(adaptiveStrategy);
      for (let i = 0; i < 100; i++) {
        policy.getEffectiveStepTicks(makeCtx({ lastLoopDurationMs: 100 }));
      }
      const result = policy.getEffectiveStepTicks(makeCtx({ lastLoopDurationMs: 100 }));
      expect(result).toBe(adaptiveStrategy.range.max);
    });

    it('clamps to range.min on continuous scale down', () => {
      const policy = new RuntimeSpeedPolicy(adaptiveStrategy);
      for (let i = 0; i < 100; i++) {
        policy.getEffectiveStepTicks(makeCtx({ lastLoopDurationMs: 900 }));
      }
      const result = policy.getEffectiveStepTicks(makeCtx({ lastLoopDurationMs: 900 }));
      expect(result).toBe(adaptiveStrategy.range.min);
    });

    it('reduces step on overlap skipped', () => {
      const policy = new RuntimeSpeedPolicy({ ...adaptiveStrategy, range: { min: 2n, max: 20n } });
      // first increase it: 2 → 3 → 4
      policy.getEffectiveStepTicks(makeCtx({ lastLoopDurationMs: 100 }));
      policy.getEffectiveStepTicks(makeCtx({ lastLoopDurationMs: 100 }));
      // now overlap: 4 → 3 (4-1 = 3, clamped to [2,20])
      const result = policy.getEffectiveStepTicks(makeCtx({ overlapSkippedCount: 1 }));
      expect(result).toBe(3n);
    });

    it('stays stable when duration is between thresholds', () => {
      const policy = new RuntimeSpeedPolicy(adaptiveStrategy);
      const result = policy.getEffectiveStepTicks(makeCtx({ lastLoopDurationMs: 500 }));
      expect(result).toBe(1n); // stable, min=1
    });
  });

  describe('setStrategy', () => {
    it('switches strategy at runtime', () => {
      const policy = new RuntimeSpeedPolicy(variableStrategy);
      expect(policy.getStrategy().kind).toBe('variable');

      policy.setStrategy(adaptiveStrategy);
      expect(policy.getStrategy().kind).toBe('adaptive');
    });

    it('resets previousStep when switching strategy', () => {
      const policy = new RuntimeSpeedPolicy(variableStrategy);
      policy.getEffectiveStepTicks(makeCtx(), 5n);

      policy.setStrategy(adaptiveStrategy);
      const result = policy.getEffectiveStepTicks(makeCtx({ lastLoopDurationMs: 100 }));
      expect(result).toBe(2n); // starts from range.min
    });

    it('clearing override reverts to configured strategy', () => {
      const policy = new RuntimeSpeedPolicy(variableStrategy);
      policy.setStrategy(adaptiveStrategy);
      expect(policy.getStrategy().kind).toBe('adaptive');

      policy.clearOverride();
      expect(policy.getStrategy().kind).toBe('variable');
    });
  });

  describe('getSnapshot', () => {
    it('returns variable mode snapshot', () => {
      const policy = new RuntimeSpeedPolicy(variableStrategy);
      const snapshot = policy.getSnapshot();
      expect(snapshot.mode).toBe('variable');
      expect(snapshot.strategy.kind).toBe('variable');
      expect(snapshot.source).toBe('default');
    });

    it('returns override source when strategy is overridden', () => {
      const policy = new RuntimeSpeedPolicy(variableStrategy);
      policy.setStrategy(adaptiveStrategy);
      const snapshot = policy.getSnapshot();
      expect(snapshot.source).toBe('override');
      expect(snapshot.override_since).not.toBeNull();
    });
  });

  describe('getLoopIntervalMs', () => {
    it('returns strategy loop interval', () => {
      const policy = new RuntimeSpeedPolicy(variableStrategy);
      expect(policy.getLoopIntervalMs()).toBe(1000);
    });

    it('returns overridden strategy loop interval', () => {
      const policy = new RuntimeSpeedPolicy(variableStrategy);
      policy.setStrategy(adaptiveStrategy);
      expect(policy.getLoopIntervalMs()).toBe(500);
    });
  });
});
