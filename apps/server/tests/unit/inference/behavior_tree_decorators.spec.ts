import { describe, expect, it } from 'vitest';

import { tick } from '../../../src/inference/providers/behavior_tree/evaluator.js';
import { tickDecorated } from '../../../src/inference/providers/behavior_tree/nodes/decorators.js';
import type { BTCooldownState,BTDecoratorDef, BTEvalContext, BTNodeDef } from '../../../src/inference/providers/behavior_tree/types.js';
import type { InferenceContext } from '../../../src/inference/types.js';

const makeCtx = (tick: bigint = BigInt(1)): BTEvalContext => ({
  inferenceContext: {
    tick,
    pack_state: {
      actor_roles: [],
      actor_state: {},
      owned_artifacts: [],
      world_state: {},
      latest_event: null,
      recent_events: []
    },
    actor_ref: { agent_id: 'agent-001' } as unknown as InferenceContext['actor_ref']
  } as unknown as InferenceContext,
  blackboard: {
    __agent_id: 'agent-001',
    __tree_name: 'test_tree'
  }
});

const successAction: BTNodeDef = { type: 'action', action: { kernel: 'noop' } };
const failureCondition: BTNodeDef = {
  type: 'condition',
  condition: { state: 'nonexistent', eq: true }
};

const setCooldownState = (ctx: BTEvalContext, key: string, lastSuccessTick: bigint): void => {
  const store = new Map<string, BTCooldownState>();
  store.set(key, { lastSuccessTick });
  ctx.blackboard['__cooldown_store'] = store;
};

describe('tickDecorated', () => {
  describe('inverter', () => {
    const inverter: BTDecoratorDef = { type: 'inverter' };

    it('child success → returns failure', async () => {
      const ctx = makeCtx();
      const status = await tickDecorated([inverter], successAction, ctx, tick);
      expect(status).toBe('failure');
    });

    it('child failure → returns success', async () => {
      const ctx = makeCtx();
      const status = await tickDecorated([inverter], failureCondition, ctx, tick);
      expect(status).toBe('success');
    });
  });

  describe('cooldown', () => {
    const cooldown: BTDecoratorDef = { type: 'cooldown', cooldown_ticks: 10 };

    it('within cooldown period → skips child, returns failure', async () => {
      const ctx = makeCtx(BigInt(100));
      setCooldownState(ctx, 'agent-001::test_tree', BigInt(95)); // 100 - 95 = 5 < 10
      const status = await tickDecorated([cooldown], successAction, ctx, tick);
      expect(status).toBe('failure');
    });

    it('outside cooldown period, child success → updates store, returns success', async () => {
      const ctx = makeCtx(BigInt(100));
      setCooldownState(ctx, 'agent-001::test_tree', BigInt(80)); // 100 - 80 = 20 >= 10
      const status = await tickDecorated([cooldown], successAction, ctx, tick);
      expect(status).toBe('success');
      const store = ctx.blackboard['__cooldown_store'] as Map<string, BTCooldownState>;
      expect(store.get('agent-001::test_tree')?.lastSuccessTick).toBe(BigInt(100));
    });

    it('outside cooldown period, child failure → does NOT update store', async () => {
      const ctx = makeCtx(BigInt(100));
      setCooldownState(ctx, 'agent-001::test_tree', BigInt(80));
      const status = await tickDecorated([cooldown], failureCondition, ctx, tick);
      expect(status).toBe('failure');
      const store = ctx.blackboard['__cooldown_store'] as Map<string, BTCooldownState>;
      expect(store.get('agent-001::test_tree')?.lastSuccessTick).toBe(BigInt(80));
    });
  });

  describe('probability', () => {
    it('weight: 0 → always returns failure', async () => {
      const probability: BTDecoratorDef = { type: 'probability', weight: 0 };
      const ctx = makeCtx();
      const status = await tickDecorated([probability], successAction, ctx, tick);
      expect(status).toBe('failure');
    });

    it('weight: 1 → always executes child', async () => {
      const probability: BTDecoratorDef = { type: 'probability', weight: 1 };
      const ctx = makeCtx();
      const status = await tickDecorated([probability], successAction, ctx, tick);
      expect(status).toBe('success');
    });

    it('same agent+tick → deterministic result', async () => {
      const probability: BTDecoratorDef = { type: 'probability', weight: 0.3 };
      const ctx = makeCtx(BigInt(42));
      const results = await Promise.all([
        tickDecorated([probability], successAction, ctx, tick),
        tickDecorated([probability], successAction, ctx, tick),
        tickDecorated([probability], successAction, ctx, tick)
      ]);
      expect(results.every((r) => r === results[0])).toBe(true);
    });
  });

  describe('stacked decorators', () => {
    it('[cooldown, probability] — within cooldown skips everything', async () => {
      const decorators: BTDecoratorDef[] = [
        { type: 'cooldown', cooldown_ticks: 10 },
        { type: 'probability', weight: 1 }
      ];
      const ctx = makeCtx(BigInt(100));
      setCooldownState(ctx, 'agent-001::test_tree', BigInt(95));
      const status = await tickDecorated(decorators, successAction, ctx, tick);
      expect(status).toBe('failure');
    });

    it('[cooldown, probability] — outside cooldown, probability wins', async () => {
      const decorators: BTDecoratorDef[] = [
        { type: 'cooldown', cooldown_ticks: 10 },
        { type: 'probability', weight: 0 }
      ];
      const ctx = makeCtx(BigInt(100));
      setCooldownState(ctx, 'agent-001::test_tree', BigInt(80));
      const status = await tickDecorated(decorators, successAction, ctx, tick);
      expect(status).toBe('failure');
    });

    it('[inverter, cooldown] — cooldown failure becomes success', async () => {
      const decorators: BTDecoratorDef[] = [
        { type: 'inverter' },
        { type: 'cooldown', cooldown_ticks: 10 }
      ];
      const ctx = makeCtx(BigInt(100));
      setCooldownState(ctx, 'agent-001::test_tree', BigInt(95));
      // cooldown → failure → inverter → success
      const status = await tickDecorated(decorators, successAction, ctx, tick);
      expect(status).toBe('success');
    });

    it('empty decorators list → executes child directly', async () => {
      const ctx = makeCtx();
      const status = await tickDecorated([], successAction, ctx, tick);
      expect(status).toBe('success');
    });
  });
});
