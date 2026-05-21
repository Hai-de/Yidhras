import { describe, expect, it } from 'vitest';

import { createBehaviorTreeProvider } from '../../src/inference/providers/behavior_tree/provider.js';
import { TreeRegistry } from '../../src/inference/providers/behavior_tree/tree_registry.js';
import type { BTCooldownState } from '../../src/inference/providers/behavior_tree/types.js';
import type { InferenceProvider } from '../../src/inference/provider.js';
import type { InferenceContext, ProviderDecisionRaw } from '../../src/inference/types.js';

const createMinimalInferenceContext = (
  overrides: Partial<InferenceContext> = {}
): InferenceContext =>
  ({
    inference_id: 'inf-test-001',
    actor_ref: {
      identity_id: 'agent-001',
      identity_type: 'agent',
      role: 'active' as const,
      agent_id: 'agent-001',
      atmosphere_node_id: null
    },
    actor_display_name: 'Test Agent',
    identity: {
      id: 'agent-001',
      type: 'agent' as const,
      name: 'Test Agent',
      provider: null,
      status: null,
      claims: null
    },
    binding_ref: null,
    resolved_agent_id: 'agent-001',
    agent_snapshot: null,
    tick: BigInt(1),
    strategy: 'behavior_tree' as const,
    attributes: { behavior_tree: 'test_tree' },
    world_pack: { id: 'test-pack', name: 'Test Pack', version: '1.0.0' },
    world_prompts: {},
    world_ai: null,
    visible_variables: {},
    variable_context: {} as InferenceContext['variable_context'],
    variable_context_summary: {} as InferenceContext['variable_context_summary'],
    policy_summary: {
      social_post_read_allowed: false,
      social_post_readable_fields: [],
      social_post_write_allowed: false,
      social_post_writable_fields: []
    },
    transmission_profile: {
      policy: 'reliable' as const,
      drop_reason: null,
      delay_ticks: '0',
      drop_chance: 0,
      derived_from: []
    },
    context_run: {} as InferenceContext['context_run'],
    memory_context: {} as InferenceContext['memory_context'],
    pack_state: {
      actor_roles: [],
      actor_state: { ready: true },
      owned_artifacts: [],
      world_state: {},
      latest_event: null,
      recent_events: []
    },
    pack_runtime: {},
    agent_capabilities: [],
    ...overrides
  }) as InferenceContext;

const setupProvider = (trees: Record<string, unknown>): InferenceProvider => {
  const registry = new TreeRegistry('test-pack');
  registry.register(trees);
  return createBehaviorTreeProvider({ treeRegistry: registry });
};

describe('behavior tree provider integration', () => {
  it('provider registration: has correct name, strategies, and requiresPrompt', () => {
    const registry = new TreeRegistry('test-pack');
    registry.register({ t: { type: 'action', action: { kernel: 'noop' } } });

    const provider = createBehaviorTreeProvider({ treeRegistry: registry });
    expect(provider.name).toBe('behavior_tree');
    expect(provider.strategies).toContain('behavior_tree');
    expect(provider.requiresPrompt).toBe(false);
  });

  it('returns ActionIntent when tree matches a condition and fires an action', async () => {
    const provider = setupProvider({
      test_tree: {
        type: 'selector',
        children: [
          {
            condition: { state: 'ready', eq: true },
            action: { semantic_intent: 'claim_notebook', reasoning: 'must acquire it' }
          }
        ]
      }
    });

    const ctx = createMinimalInferenceContext();
    const result: ProviderDecisionRaw = await provider.run(ctx, null as never);

    expect(result.action_type).toBe('claim_notebook');
    expect(result.reasoning).toBe('must acquire it');
  });

  it('returns idle decision when no condition matches', async () => {
    const provider = setupProvider({
      test_tree: {
        type: 'selector',
        children: [
          {
            type: 'condition',
            condition: { state: 'nonexistent', eq: true }
          }
        ]
      }
    });

    const ctx = createMinimalInferenceContext();
    const result = await provider.run(ctx, null as never);

    expect(result.action_type).toBe('idle');
    expect(result.payload).toEqual({ reason: 'behavior_tree_no_decision' });
  });

  it('returns idle decision when no tree name is configured', async () => {
    const provider = setupProvider({
      test_tree: { type: 'action', action: { kernel: 'noop' } }
    });

    const ctx = createMinimalInferenceContext({ attributes: {} });
    const result = await provider.run(ctx, null as never);

    expect(result.action_type).toBe('idle');
    expect(result.payload).toEqual({ reason: 'behavior_tree_no_tree_name' });
  });

  it('resolves tree name from context.attributes.behavior_tree', async () => {
    const provider = setupProvider({
      my_custom_tree: {
        type: 'action',
        action: { semantic_intent: 'custom_action', reasoning: 'from attributes' }
      }
    });

    const ctx = createMinimalInferenceContext({
      attributes: { behavior_tree: 'my_custom_tree' }
    });
    const result = await provider.run(ctx, null as never);

    expect(result.action_type).toBe('custom_action');
  });

  it('cooldown decorator: respects cooldown across multiple ticks', async () => {
    const provider = setupProvider({
      test_tree: {
        decorators: [{ type: 'cooldown', cooldown_ticks: 10 }],
        child: {
          type: 'action',
          action: { semantic_intent: 'publish_update', reasoning: 'publishing' }
        }
      }
    });

    // Tick 1: first execution — should succeed and set cooldown
    const ctx1 = createMinimalInferenceContext({ tick: BigInt(1) });
    const result1 = await provider.run(ctx1, null as never);
    expect(result1.action_type).toBe('publish_update');

    // Tick 5: within cooldown (5-1=4 < 10) — should be idle
    const ctx5 = createMinimalInferenceContext({ tick: BigInt(5) });
    const result5 = await provider.run(ctx5, null as never);
    expect(result5.action_type).toBe('idle');

    // Tick 15: cooldown expired (15-1=14 >= 10) — should fire again
    const ctx15 = createMinimalInferenceContext({ tick: BigInt(15) });
    const result15 = await provider.run(ctx15, null as never);
    expect(result15.action_type).toBe('publish_update');
  });

  it('mixed Selector with conditions and actions: respects priority chain', async () => {
    const provider = setupProvider({
      test_tree: {
        type: 'selector',
        children: [
          {
            condition: { event_semantic_type: 'suspicious_death_occurred' },
            action: { semantic_intent: 'investigate_death', reasoning: 'suspicious event detected' }
          },
          {
            action: { semantic_intent: 'patrol', reasoning: 'routine patrol' }
          }
        ]
      }
    });

    // No suspicious events → first guarded action fails → falls through to patrol
    const ctx = createMinimalInferenceContext({
      pack_state: {
        actor_roles: [],
        actor_state: {},
        owned_artifacts: [],
        world_state: {},
        latest_event: null,
        recent_events: []
      }
    });
    const result = await provider.run(ctx, null as never);
    expect(result.action_type).toBe('patrol');

    // With suspicious event → first guarded action fires
    const ctx2 = createMinimalInferenceContext({
      pack_state: {
        actor_roles: [],
        actor_state: {},
        owned_artifacts: [],
        world_state: {},
        latest_event: null,
        recent_events: [
          {
            event_id: 'evt-1',
            title: 'Death',
            type: 'narrative',
            semantic_type: 'suspicious_death_occurred',
            tick: '1',
            created_at: '2026-01-01T00:00:00Z'
          }
        ]
      }
    });
    const result2 = await provider.run(ctx2, null as never);
    expect(result2.action_type).toBe('investigate_death');
    expect(result2.reasoning).toBe('suspicious event detected');
  });

  it('Sequence node: condition guard before action', async () => {
    const provider = setupProvider({
      test_tree: {
        type: 'sequence',
        children: [
          {
            type: 'condition',
            condition: { state: 'ready', eq: true }
          },
          {
            type: 'action',
            action: { semantic_intent: 'proceed', reasoning: 'ready to go' }
          }
        ]
      }
    });

    const ctx = createMinimalInferenceContext();
    const result = await provider.run(ctx, null as never);
    expect(result.action_type).toBe('proceed');
  });

  it('throws for non-existent tree name', () => {
    const provider = setupProvider({
      other_tree: { type: 'action', action: { kernel: 'noop' } }
    });

    const ctx = createMinimalInferenceContext({
      attributes: { behavior_tree: 'nonexistent_tree' }
    });

    expect(provider.run(ctx, null as never)).rejects.toThrow();
  });

  it('llm_decision leaf stub returns failure (awaits Phase 6 AI Gateway wiring)', async () => {
    const provider = setupProvider({
      test_tree: {
        type: 'selector',
        children: [
          {
            type: 'llm_decision',
            prompt_template: 'test',
            provider: 'openai_compatible',
            model: 'test-model'
          },
          {
            type: 'action',
            action: { semantic_intent: 'fallback_action' }
          }
        ]
      }
    });

    const ctx = createMinimalInferenceContext();
    const result = await provider.run(ctx, null as never);
    // llm_decision stub returns failure → Selector falls through to action
    expect(result.action_type).toBe('fallback_action');
  });
});
