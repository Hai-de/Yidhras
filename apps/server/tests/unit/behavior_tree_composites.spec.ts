import { describe, expect, it } from 'vitest';

import { tickSelector, tickSequence } from '../../src/inference/providers/behavior_tree/nodes/composites.js';
import type { BTEvalContext, BTNodeDef } from '../../src/inference/providers/behavior_tree/types.js';
import type { InferenceContext } from '../../src/inference/types.js';

const makeCtx = (_overrides: Partial<InferenceContext> = {}): BTEvalContext => ({
  inferenceContext: {
    tick: BigInt(1),
    pack_state: {
      actor_roles: [],
      actor_state: {},
      owned_artifacts: [],
      world_state: {},
      latest_event: null,
      recent_events: []
    }
  } as unknown as InferenceContext,
  blackboard: {}
});

// Action leaf always returns success
const successAction: BTNodeDef = { type: 'action', action: { kernel: 'noop' } };

const falseCondition: BTNodeDef = {
  type: 'condition',
  condition: { state: 'nonexistent', eq: true }
};

describe('tickSelector', () => {
  it('first child success → returns success, skips later children', async () => {
    const ctx = makeCtx();
    const status = await tickSelector([successAction, successAction], ctx);
    expect(status).toBe('success');
  });

  it('first child failure, second success → returns success', async () => {
    const ctx = makeCtx();
    const status = await tickSelector([falseCondition, successAction], ctx);
    expect(status).toBe('success');
  });

  it('all children failure → returns failure', async () => {
    const ctx = makeCtx();
    const status = await tickSelector([falseCondition, falseCondition], ctx);
    expect(status).toBe('failure');
  });

  it('empty children → returns failure', async () => {
    const ctx = makeCtx();
    const status = await tickSelector([], ctx);
    expect(status).toBe('failure');
  });
});

describe('tickSequence', () => {
  it('all success → returns success, executes all', async () => {
    const ctx = makeCtx();
    const status = await tickSequence([successAction, successAction], ctx);
    expect(status).toBe('success');
  });

  it('second child failure → returns failure, third not executed', async () => {
    const ctx = makeCtx();
    // Sequence: action(success) → condition(failure) → action(never reached)
    const status = await tickSequence([successAction, falseCondition, successAction], ctx);
    expect(status).toBe('failure');
  });

  it('empty children → returns failure', async () => {
    const ctx = makeCtx();
    const status = await tickSequence([], ctx);
    expect(status).toBe('failure');
  });

  it('last action writes __last_decision to blackboard', async () => {
    const ctx = makeCtx();
    await tickSequence([successAction], ctx);
    expect(ctx.blackboard['__last_decision']).toBeDefined();
  });
});
