import { afterEach, describe, expect, it } from 'vitest';

import { createBehaviorControlExecutor } from '../../src/context/workflow/executors/behavior_control.js';
import type { PromptWorkflowProfile, PromptWorkflowState, PromptWorkflowStepSpec } from '../../src/context/workflow/types.js';
import { createInitialPromptWorkflowState } from '../../src/context/workflow/types.js';
import type { SlotBehaviorProfile } from '../../src/inference/slot_behavior.js';
import { slotConditionRegistry } from '../../src/plugins/extensions/slot_condition_registry.js';

// ── helpers ──

function makeTree(slotId = 'test_slot') {
  return {
    inference_id: 'inf-test',
    task_type: 'agent_decision',
    fragments_by_slot: {
      [slotId]: [{
        id: 'frag-1', slot_id: slotId, priority: 10, source: 'test',
        removable: true, replaceable: false, children: [],
        permission_denied: false, estimated_tokens: 100, metadata: {}
      }]
    },
    slot_registry: {
      [slotId]: { id: slotId, default_priority: 10, enabled: true }
    } as Record<string, unknown> as PromptWorkflowState['slot_registry'],
    resolved_positions: [],
    metadata: { prompt_version: '1', profile_id: null, profile_version: null, source_prompt_keys: [] }
  };
}

function makeMinimalState(overrides: Partial<PromptWorkflowState> = {}): PromptWorkflowState {
  const base = createInitialPromptWorkflowState({
    context_run: { id: 'run-1', created_at_tick: '0', nodes: [], selected_node_ids: [], diagnostics: { source_adapter_names: [], node_count: 0, node_counts_by_type: {}, selected_node_ids: [], dropped_nodes: [] } },
    actor_ref: { identity_id: 'e1', role: 'active', identity_type: 'agent', agent_id: 'agent-1', atmosphere_node_id: null },
    task_type: 'agent_decision',
    strategy: 'mock',
    pack_id: 'test-pack',
    profile: { id: 'test', version: '1', applies_to: {}, steps: [] }
  });
  return { ...base, ...overrides } as PromptWorkflowState;
}

function makeMinimalContext(tick = 100) {
  return {
    inference_id: 'inf-test', tick: BigInt(tick),
    strategy: 'mock' as const, attributes: {}, world_prompts: {},
    variable_context: { layers: [], summary: { total_variables: 0, layers_merged: 0, namespaces: [] } },
    variable_context_summary: { total_variables: 0, layers_merged: 0, namespaces: [] },
    context_run: { id: 'run-1', nodes: [], metadata: {} },
    memory_context: { pack_id: 'test-pack', memory_blocks: [], overlays: [], metadata: {} },
    pack_runtime: {},
    world_pack: { id: 'test-pack', name: 'Test', version: '1' },
    actor_ref: { identity_id: 'e1', role: 'active' as const },
    actor_display_name: 'Test', identity: { identity_id: 'id1', name: 'Test', type: 'agent' as const },
    binding_ref: null, resolved_agent_id: null, agent_snapshot: null,
    pack_state: { entities: {}, relationships: [] },
    visible_variables: {},
    policy_summary: { allowed_actions: [], permissions: [] },
    transmission_profile: { max_tokens: 4096, temperature: 0.7 }
  };
}

const minimalProfile: PromptWorkflowProfile = { id: 'p', version: '1', applies_to: {}, steps: [] };
const minimalSpec: PromptWorkflowStepSpec = { key: 'behavior', kind: 'behavior_control' };

// ── tests ──

describe('behavior_control executor — custom evaluator via plugin registry', () => {
  afterEach(() => {
    slotConditionRegistry.clear();
  });

  it('calls registered custom evaluator for custom condition type', async () => {
    // Register a custom evaluator in the per-pack registry
    slotConditionRegistry.register('test-pack', {
      key: 'slot_condition.always_true',
      version: '1.0.0',
      evaluate: async () => ({ active: true, reason: 'custom: always true' })
    });

    const executor = createBehaviorControlExecutor();
    const state = makeMinimalState({
      tree: makeTree() as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        conditions: [{
          type: 'custom',
          evaluator_key: 'slot_condition.always_true'
        }]
      } as SlotBehaviorProfile]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: minimalProfile,
      spec: minimalSpec,
      state
    });

    expect(result.slot_behavior_diagnostics!.slots_activated).toContain('test_slot');
  });

  it('deactivates slot when custom evaluator returns false', async () => {
    slotConditionRegistry.register('test-pack', {
      key: 'slot_condition.always_false',
      version: '1.0.0',
      evaluate: async () => ({ active: false, reason: 'custom: blocked' })
    });

    const executor = createBehaviorControlExecutor();
    const state = makeMinimalState({
      tree: makeTree() as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        conditions: [{
          type: 'custom',
          evaluator_key: 'slot_condition.always_false'
        }]
      } as SlotBehaviorProfile]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: minimalProfile,
      spec: minimalSpec,
      state
    });

    expect(result.slot_behavior_diagnostics!.slots_disabled).toContain('test_slot');
  });

  it('deactivates slot when custom evaluator not found', async () => {
    const executor = createBehaviorControlExecutor();
    const state = makeMinimalState({
      tree: makeTree() as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        conditions: [{
          type: 'custom',
          evaluator_key: 'slot_condition.does_not_exist'
        }]
      } as SlotBehaviorProfile]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: minimalProfile,
      spec: minimalSpec,
      state
    });

    expect(result.slot_behavior_diagnostics!.slots_disabled).toContain('test_slot');
    expect(result.slot_behavior_diagnostics!.evaluation_errors).toHaveLength(0);
  });

  it('per-pack isolation: evaluator in other pack is not visible', async () => {
    // Register in pack-b, but state uses pack_id: 'test-pack'
    slotConditionRegistry.register('other-pack', {
      key: 'slot_condition.wrong_pack',
      version: '1.0.0',
      evaluate: async () => ({ active: true, reason: 'should not be called' })
    });

    const executor = createBehaviorControlExecutor();
    const state = makeMinimalState({
      tree: makeTree() as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        conditions: [{
          type: 'custom',
          evaluator_key: 'slot_condition.wrong_pack'
        }]
      } as SlotBehaviorProfile]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: minimalProfile,
      spec: minimalSpec,
      state
    });

    // Evaluator registered in 'other-pack' but state is 'test-pack' → not found → disabled
    expect(result.slot_behavior_diagnostics!.slots_disabled).toContain('test_slot');
  });

  it('evaluator_failure_policy: deactivate on custom evaluator error', async () => {
    slotConditionRegistry.register('test-pack', {
      key: 'slot_condition.broken',
      version: '1.0.0',
      evaluate: async () => { throw new Error('boom'); }
    });

    const executor = createBehaviorControlExecutor();
    const state = makeMinimalState({
      tree: makeTree() as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        conditions: [{ type: 'custom', evaluator_key: 'slot_condition.broken' }],
        evaluator_failure_policy: 'deactivate'
      } as SlotBehaviorProfile]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: minimalProfile,
      spec: minimalSpec,
      state
    });

    expect(result.slot_behavior_diagnostics!.slots_disabled).toContain('test_slot');
  });

  it('combines builtin and custom conditions with AND', async () => {
    slotConditionRegistry.register('test-pack', {
      key: 'slot_condition.check_length',
      version: '1.0.0',
      evaluate: async (ctx) => ({
        active: ctx.last_user_message.length > 5,
        reason: `length check: ${ctx.last_user_message.length}`
      })
    });

    const executor = createBehaviorControlExecutor();
    const state = makeMinimalState({
      tree: makeTree() as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        conditions: [
          { type: 'keyword_match', keywords: ['hello'] },
          { type: 'custom', evaluator_key: 'slot_condition.check_length' }
        ],
        condition_combination: 'and'
      } as SlotBehaviorProfile],
      ai_messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello world' }], name: 'user' }]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: minimalProfile,
      spec: minimalSpec,
      state
    });

    // 'hello' found + 'hello world'.length = 11 > 5 → both true → AND → active
    expect(result.slot_behavior_diagnostics!.slots_activated).toContain('test_slot');
  });
});
