import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type BehaviorStateStore,
  createMemoryBehaviorStateStore,
  setBehaviorStateStore} from '../../src/app/behavior_state_store.js';
import { createBehaviorControlExecutor } from '../../src/context/workflow/executors/behavior_control.js';
import type { PromptWorkflowProfile, PromptWorkflowState, PromptWorkflowStepSpec  } from '../../src/context/workflow/types.js';
import { createInitialPromptWorkflowState } from '../../src/context/workflow/types.js';
import type { SlotBehaviorProfile } from '../../src/inference/slot_behavior.js';
import { expectDefined } from '../helpers/assertions.js';

// ── Helpers ──

function makeTree(slotId = 'test_slot') {
  return {
    inference_id: 'inf-test',
    task_type: 'agent_decision',
    fragments_by_slot: {
      [slotId]: [{
        id: 'frag-1',
        slot_id: slotId,
        priority: 10,
        source: 'test',
        removable: true,
        replaceable: false,
        children: [],
        permission_denied: false,
        estimated_tokens: 100,
        metadata: {}
      }]
    },
    slot_registry: {
      [slotId]: { id: slotId, default_priority: 10, enabled: true }
    } as Record<string, unknown> as PromptWorkflowState['slot_registry'],
    resolved_positions: [],
    metadata: { prompt_version: '1', profile_id: null, profile_version: null, source_prompt_keys: [] }
  };
}

function makeMinimalProfile(): PromptWorkflowProfile {
  return { id: 'test-profile', version: '1', applies_to: {}, steps: [] };
}

function makeMinimalSpec(): PromptWorkflowStepSpec {
  return { key: 'behavior', kind: 'behavior_control' };
}

function makeMinimalState(overrides: Partial<PromptWorkflowState> = {}): PromptWorkflowState {
  const base = createInitialPromptWorkflowState({
    context_run: { id: 'run-1', created_at_tick: '0', nodes: [], selected_node_ids: [], diagnostics: { source_adapter_names: [], node_count: 0, node_counts_by_type: {}, selected_node_ids: [], dropped_nodes: [] } },
    actor_ref: { identity_id: 'e1', role: 'active', identity_type: 'agent', agent_id: 'agent-1', atmosphere_node_id: null },
    task_type: 'agent_decision',
    strategy: 'mock',
    pack_id: 'test-pack',
    profile: makeMinimalProfile()
  });
  return { ...base, ...overrides } as PromptWorkflowState;
}

function makeMinimalContext(tick = 100) {
  return {
    inference_id: 'inf-test',
    tick: BigInt(tick),
    strategy: 'mock' as const,
    attributes: {},
    world_prompts: {},
    variable_context: { layers: [], summary: { total_variables: 0, layers_merged: 0, namespaces: [] } },
    variable_context_summary: { total_variables: 0, layers_merged: 0, namespaces: [] },
    context_run: { id: 'run-1', nodes: [], metadata: {} },
    memory_context: { pack_id: 'test-pack', memory_blocks: [], overlays: [], metadata: {} },
    pack_runtime: {},
    world_pack: { id: 'test-pack', name: 'Test Pack', version: '1' },
    actor_ref: { identity_id: 'e1', role: 'active' as const },
    actor_display_name: 'Test Actor',
    identity: { identity_id: 'id1', name: 'Test', type: 'agent' as const },
    binding_ref: null,
    resolved_agent_id: null,
    agent_snapshot: null,
    pack_state: { entities: {}, relationships: [] },
    visible_variables: {},
    policy_summary: { allowed_actions: [], permissions: [] },
    transmission_profile: { max_tokens: 4096, temperature: 0.7 }
  };
}

const diagnosticsOf = (state: PromptWorkflowState) => expectDefined(state.slot_behavior_diagnostics, 'slot behavior diagnostics');

const behaviorStateOf = (state: PromptWorkflowState, slotId: string) => {
  const states = expectDefined(state.behavior_states, 'behavior states');
  return expectDefined(states[slotId], `behavior state ${slotId}`);
};

// ── Tests ──

describe('behavior_control executor — stateful', () => {
  let store: BehaviorStateStore;

  beforeEach(() => {
    store = createMemoryBehaviorStateStore();
    setBehaviorStateStore(store);
  });

  afterEach(() => {
    setBehaviorStateStore(null as unknown as BehaviorStateStore);
  });

  it('persists behavior state across inference runs', async () => {
    const executor = createBehaviorControlExecutor();

    // Run 1: activate with sticky=3 → should activate and set sticky_remaining=2
    const state1 = makeMinimalState({
      tree: makeTree() as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        sticky: { max_activations: 3 }
      } as SlotBehaviorProfile]
    });

    const result1 = await executor.execute({
      context: makeMinimalContext(1) as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state: state1
    });

    expect(diagnosticsOf(result1).slots_activated).toContain('test_slot');

    // Verify state is in store
    const stored = store.getState('test_slot', 'test-pack');
    const storedState = expectDefined(stored, 'stored behavior state');
    expect(storedState.status).toBe('Active');
    expect(storedState.sticky_remaining).toBe(2);

    // Run 2: same slot — should be in Retained state (sticky)
    const state2 = makeMinimalState({
      tree: makeTree() as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        sticky: { max_activations: 3 }
      } as SlotBehaviorProfile]
    });

    const result2 = await executor.execute({
      context: makeMinimalContext(2) as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state: state2
    });

    // Sticky should still activate (Retained state skips condition eval)
    expect(diagnosticsOf(result2).slots_activated).toContain('test_slot');
    expect(behaviorStateOf(result2, 'test_slot').sticky_remaining).toBe(1);
  });

  it('cooldown prevents activation across runs', async () => {
    const executor = createBehaviorControlExecutor();

    // Run 1 (tick=1): First activation → Active state, slot activated
    const state1 = makeMinimalState({
      tree: makeTree() as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        cooldown: { ticks: 5 }
      } as SlotBehaviorProfile]
    });

    const result1 = await executor.execute({
      context: makeMinimalContext(1) as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state: state1
    });

    expect(diagnosticsOf(result1).slots_activated).toContain('test_slot');
    // Active → Cooling transition happens at end of activation cycle
    expect(behaviorStateOf(result1, 'test_slot').status).toBe('Active');

    // Run 2 (tick=3): Active → Cooling (transitions to Cooling, activation overridden)
    const state2 = makeMinimalState({
      tree: makeTree() as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        cooldown: { ticks: 5 }
      } as SlotBehaviorProfile]
    });

    const result2 = await executor.execute({
      context: makeMinimalContext(3) as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state: state2
    });

    // Post-transition override: Cooling → slot disabled
    expect(diagnosticsOf(result2).slots_disabled).toContain('test_slot');
    expect(behaviorStateOf(result2, 'test_slot').status).toBe('Cooling');

    // Run 3 (tick=10): Cooling → Pending (cooldown elapsed), slot activated again
    const state3 = makeMinimalState({
      tree: makeTree() as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        cooldown: { ticks: 5 }
      } as SlotBehaviorProfile]
    });

    const result3 = await executor.execute({
      context: makeMinimalContext(10) as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state: state3
    });

    // cooldown elapsed at tick=10 (cooldown_until_tick was 6 or 8 depending on timing)
    expect(diagnosticsOf(result3).slots_activated).toContain('test_slot');
  });

  it('delayed_trigger adds latency across runs', async () => {
    const executor = createBehaviorControlExecutor();

    // Run 1 (tick=1): Pending + delay=3 → Delayed (post-transition overrides to inactive)
    const state1 = makeMinimalState({
      tree: makeTree() as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        delayed_trigger: { delay_ticks: 3 }
      } as SlotBehaviorProfile]
    });

    const result1 = await executor.execute({
      context: makeMinimalContext(1) as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state: state1
    });

    // Post-transition: Delayed → override to inactive
    expect(diagnosticsOf(result1).slots_disabled).toContain('test_slot');
    expect(behaviorStateOf(result1, 'test_slot').status).toBe('Delayed');

    // Run 2 (tick=2): Still Delayed (delay_until_tick=4), Delayed check in evaluateSlotActivation catches it
    const state2 = makeMinimalState({
      tree: makeTree() as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        delayed_trigger: { delay_ticks: 3 }
      } as SlotBehaviorProfile]
    });

    const result2 = await executor.execute({
      context: makeMinimalContext(2) as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state: state2
    });

    expect(diagnosticsOf(result2).slots_disabled).toContain('test_slot');
    expect(behaviorStateOf(result2, 'test_slot').status).toBe('Delayed');

    // Run 3 (tick=5): Delay elapsed → Active, slot activated
    const state3 = makeMinimalState({
      tree: makeTree() as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        delayed_trigger: { delay_ticks: 3 }
      } as SlotBehaviorProfile]
    });

    const result3 = await executor.execute({
      context: makeMinimalContext(5) as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state: state3
    });

    expect(diagnosticsOf(result3).slots_activated).toContain('test_slot');
    expect(behaviorStateOf(result3, 'test_slot').status).toBe('Active');
  });

  it('state store loads previous state across runs', async () => {
    const executor = createBehaviorControlExecutor();

    // Pre-populate store with a Retained state
    store.setState('pre_existing', 'test-pack', {
      slot_id: 'pre_existing',
      status: 'Cooling',
      cooldown_until_tick: 50,
      trigger_count: 5
    });

    const state = makeMinimalState({
      tree: makeTree('pre_existing') as never,
      behavior_profiles: [{
        slot_id: 'pre_existing'
      } as SlotBehaviorProfile]
    });

    const result = await executor.execute({
      context: makeMinimalContext(10) as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    // Still cooling at tick=10 → should be disabled
    expect(diagnosticsOf(result).slots_disabled).toContain('pre_existing');
    // Should have loaded the pre-existing state
    expect(behaviorStateOf(result, 'pre_existing').trigger_count).toBe(5);
  });

  it('clears state for conversation scope', () => {
    store.setState('slot_a', 'pack-1', {
      slot_id: 'slot_a', status: 'Active', trigger_count: 3
    });

    store.clearForConversation('pack-1', 'conv-1');

    const cleared = store.getState('slot_a', 'pack-1');
    expect(cleared).toBeUndefined();
  });

  it('clears state for inference scope', () => {
    store.setState('slot_a', 'pack-1', {
      slot_id: 'slot_a', status: 'Active', trigger_count: 3
    });

    store.clearForInference('pack-1', 'inf-1');

    const cleared = store.getState('slot_a', 'pack-1');
    expect(cleared).toBeUndefined();
  });
});
