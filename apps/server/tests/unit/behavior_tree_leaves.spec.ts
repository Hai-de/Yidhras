import { describe, expect, it } from 'vitest';
import { tickAction, tickCondition, tickLLMDecision } from '../../src/inference/providers/behavior_tree/nodes/leaves.js';
import type { BTEvalContext, BTActionDef, BTLLMDecisionDef } from '../../src/inference/providers/behavior_tree/types.js';
import type { InferenceContext } from '../../src/inference/types.js';

const makeCtx = (): BTEvalContext => ({
  inferenceContext: {
    tick: BigInt(1),
    pack_state: {
      actor_roles: [],
      actor_state: { murderous_intent: true },
      owned_artifacts: [],
      world_state: {},
      latest_event: null,
      recent_events: []
    }
  } as unknown as InferenceContext,
  blackboard: {}
});

describe('tickCondition', () => {
  it('condition satisfied → success', () => {
    const ctx = makeCtx();
    const status = tickCondition({ state: 'murderous_intent', eq: true }, ctx);
    expect(status).toBe('success');
  });

  it('condition not satisfied → failure', () => {
    const ctx = makeCtx();
    const status = tickCondition({ state: 'murderous_intent', eq: false }, ctx);
    expect(status).toBe('failure');
  });

  it('missing condition → failure', () => {
    const ctx = makeCtx();
    const status = tickCondition(undefined, ctx);
    expect(status).toBe('failure');
  });
});

describe('tickAction', () => {
  it('semantic_intent action → writes __last_decision to blackboard', () => {
    const ctx = makeCtx();
    const action: BTActionDef = { semantic_intent: 'claim_notebook', reasoning: 'must have it' };
    const status = tickAction(action, ctx);
    expect(status).toBe('success');
    expect(ctx.blackboard['__last_decision']).toBeDefined();
    const decision = ctx.blackboard['__last_decision'] as Record<string, unknown>;
    expect(decision.action_type).toBe('claim_notebook');
    expect(decision.reasoning).toBe('must have it');
  });

  it('kernel action → writes __last_decision with kernel action_type', () => {
    const ctx = makeCtx();
    const action: BTActionDef = {
      kernel: 'trigger_event',
      payload: { event_type: 'history', title: 'Observe' }
    };
    const status = tickAction(action, ctx);
    expect(status).toBe('success');
    const decision = ctx.blackboard['__last_decision'] as Record<string, unknown>;
    expect(decision.action_type).toBe('trigger_event');
    expect((decision.payload as Record<string, unknown>).event_type).toBe('history');
  });

  it('action with target_ref → DecisionResult includes target_ref', () => {
    const ctx = makeCtx();
    const action: BTActionDef = {
      semantic_intent: 'gather_target_intel',
      target_ref: { entity_id: 'agent-002', kind: 'actor' }
    };
    tickAction(action, ctx);
    const decision = ctx.blackboard['__last_decision'] as Record<string, unknown>;
    expect(decision.target_ref).toEqual({ entity_id: 'agent-002', kind: 'actor' });
  });
});

describe('tickLLMDecision', () => {
  it('stub implementation returns failure (Phase 6 wires AI Gateway)', async () => {
    const ctx = makeCtx();
    const llm: BTLLMDecisionDef = {
      prompt_template: 'test_template',
      provider: 'openai_compatible',
      model: 'test-model'
    };
    const status = await tickLLMDecision(llm, ctx);
    expect(status).toBe('failure');
  });
});
