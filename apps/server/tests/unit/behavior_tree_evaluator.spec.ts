import { describe, expect, it } from 'vitest';
import { evaluateTree } from '../../src/inference/providers/behavior_tree/evaluator.js';
import type { BTEvalContext, BTNodeDef } from '../../src/inference/providers/behavior_tree/types.js';
import type { InferenceContext } from '../../src/inference/types.js';

const makeCtx = (tick: bigint = BigInt(1)): BTEvalContext => ({
  inferenceContext: {
    tick,
    actor_ref: { agent_id: 'agent-001' } as unknown as InferenceContext['actor_ref'],
    pack_state: {
      actor_roles: [],
      actor_state: { ready: true, knows_notebook_power: true, target_name_confirmed: true },
      owned_artifacts: [{ id: 'artifact-death-note', state: {} }],
      world_state: {},
      latest_event: null,
      recent_events: []
    }
  } as unknown as InferenceContext,
  blackboard: {}
});

const claimNotebookTree: BTNodeDef = {
  type: 'selector',
  children: [
    {
      type: 'condition',
      condition: { not_has_artifact: 'artifact-death-note' }
    },
    {
      type: 'action',
      action: { semantic_intent: 'claim_notebook', reasoning: 'need notebook' }
    }
  ]
};

describe('evaluateTree', () => {
  it('returns first matching action DecisionResult', async () => {
    const ctx = makeCtx();
    const result = await evaluateTree('test', claimNotebookTree, ctx);
    expect(result.decision).toBeDefined();
    expect(result.decision?.action_type).toBeDefined();
  });

  it('returns null decision when no condition matches', async () => {
    const ctx = makeCtx();
    // agent doesn't have any artifacts, so not_has_artifact is true → first child SUCCESS
    // Wait, not_has_artifact: 'artifact-death-note' — agent DOES have it, so returns false
    // The Selector tries next child: a bare action (no condition), which always succeeds
    // Let me build a tree where all conditions fail
    const allFailTree: BTNodeDef = {
      type: 'selector',
      children: [
        { type: 'condition', condition: { state: 'nonexistent', eq: true } },
        { type: 'condition', condition: { state: 'nonexistent2', eq: true } }
      ]
    };
    const result = await evaluateTree('fail_test', allFailTree, ctx);
    expect(result.decision).toBeNull();
  });

  it('produces a complete decision trace', async () => {
    const ctx = makeCtx();
    const result = await evaluateTree('trace_test', claimNotebookTree, ctx);
    expect(result.trace).toBeDefined();
    expect(result.trace.treeName).toBe('trace_test');
    expect(result.trace.agentId).toBe('agent-001');
    expect(result.trace.nodeTraces.length).toBeGreaterThan(0);
  });

  it('catches internal errors and returns null decision', async () => {
    const ctx = makeCtx();
    // A malformed node that will cause an error during evaluation
    const badTree: BTNodeDef = {
      type: 'action'
      // missing action field
    };
    const result = await evaluateTree('bad', badTree, ctx);
    // Should not throw — returns null decision
    expect(result.decision).toBeNull();
  });

  it('cooldown wraps action and respects cooldown period', async () => {
    const ctx = makeCtx();
    // Pre-populate cooldown state in blackboard
    ctx.blackboard['__cooldown_store'] = new Map();
    (ctx.blackboard['__cooldown_store'] as Map<string, unknown>).set('agent-001::cool', { lastSuccessTick: BigInt(1) });

    const cooldownTree: BTNodeDef = {
      decorators: [{ type: 'cooldown', cooldown_ticks: 10 }],
      child: { type: 'action', action: { kernel: 'noop' } }
    };
    // tick 2: 2-1=1 < 10 → within cooldown → failure → null decision
    const ctx2 = makeCtx(BigInt(2));
    ctx2.blackboard['__cooldown_store'] = ctx.blackboard['__cooldown_store'];
    const resultIn = await evaluateTree('cool', cooldownTree, ctx2);
    expect(resultIn.decision).toBeNull();

    // tick 15: 15-1=14 >= 10 → cooldown expired → action fires → success
    const ctx15 = makeCtx(BigInt(15));
    ctx15.blackboard['__cooldown_store'] = ctx.blackboard['__cooldown_store'];
    const resultOut = await evaluateTree('cool', cooldownTree, ctx15);
    expect(resultOut.decision).toBeDefined();
  });
});
