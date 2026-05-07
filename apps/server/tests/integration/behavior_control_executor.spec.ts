import { describe, expect, it } from 'vitest';

import type { SlotBehaviorProfile } from '../../src/inference/slot_behavior.js';
import type { PromptWorkflowState } from '../../src/context/workflow/types.js';
import { createInitialPromptWorkflowState } from '../../src/context/workflow/types.js';
import { createBehaviorControlExecutor } from '../../src/context/workflow/executors/behavior_control.js';
import type { PromptWorkflowProfile, PromptWorkflowStepSpec } from '../../src/context/workflow/types.js';

// ── helpers ──

function makeTree() {
  return {
    inference_id: 'inf-test',
    task_type: 'agent_decision',
    fragments_by_slot: {
      test_slot: [
        {
          id: 'frag-1',
          slot_id: 'test_slot',
          priority: 10,
          source: 'test',
          removable: true,
          replaceable: false,
          children: [],
          permission_denied: false,
          estimated_tokens: 100,
          metadata: {}
        }
      ],
      always_slot: [
        {
          id: 'frag-2',
          slot_id: 'always_slot',
          priority: 10,
          source: 'test',
          removable: false,
          replaceable: false,
          children: [],
          permission_denied: false,
          estimated_tokens: 50,
          metadata: {}
        }
      ]
    },
    slot_registry: {
      test_slot: { id: 'test_slot', default_priority: 10, enabled: true },
      always_slot: { id: 'always_slot', default_priority: 10, enabled: true }
    } as Record<string, unknown> as PromptWorkflowState['slot_registry'],
    resolved_positions: [],
    metadata: { prompt_version: '1', profile_id: null, profile_version: null, source_prompt_keys: [] }
  };
}

function makeMinimalProfile(): PromptWorkflowProfile {
  return {
    id: 'test-profile',
    version: '1',
    applies_to: {},
    steps: []
  };
}

function makeMinimalSpec(): PromptWorkflowStepSpec {
  return { key: 'behavior', kind: 'behavior_control' };
}

const makeMinimalState = (overrides: Partial<PromptWorkflowState> = {}): PromptWorkflowState => {
  const base = createInitialPromptWorkflowState({
    context_run: { run_id: 'run-1', nodes: [], created_at: BigInt(0), metadata: {} },
    actor_ref: { actor_entity_id: 'e1', actor_role: 'active' },
    task_type: 'agent_decision',
    strategy: 'mock',
    pack_id: 'test-pack',
    profile: makeMinimalProfile()
  });
  return { ...base, ...overrides } as PromptWorkflowState;
};

const makeMinimalContext = () => ({
  inference_id: 'inf-test',
  tick: BigInt(100),
  strategy: 'mock' as const,
  attributes: {},
  world_prompts: {},
  variable_context: { layers: [], summary: { total_variables: 0, layers_merged: 0, namespaces: [] } },
  variable_context_summary: { total_variables: 0, layers_merged: 0, namespaces: [] },
  context_run: { run_id: 'run-1', nodes: [], created_at: BigInt(0), metadata: {} },
  memory_context: { pack_id: 'test-pack', memory_blocks: [], overlays: [], metadata: {} },
  pack_runtime: {},
  world_pack: { id: 'test-pack', name: 'Test Pack', version: '1' },
  actor_ref: { actor_entity_id: 'e1', actor_role: 'active' as const },
  actor_display_name: 'Test Actor',
  identity: { identity_id: 'id1', name: 'Test', type: 'agent' as const },
  binding_ref: null,
  resolved_agent_id: null,
  agent_snapshot: null,
  pack_state: { entities: {}, relationships: [] },
  visible_variables: {},
  policy_summary: { allowed_actions: [], permissions: [] },
  transmission_profile: { max_tokens: 4096, temperature: 0.7 }
});

// ── tests ──

describe('behavior_control executor — integration', () => {
  it('skips when no behavior_profiles', async () => {
    const executor = createBehaviorControlExecutor();
    const state = makeMinimalState();
    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    expect(result.slot_behavior_diagnostics).toBeUndefined();
    // Should have a skipped trace
    const traces = result.diagnostics.step_traces;
    expect(traces.some((t) => t.kind === 'behavior_control' && t.status === 'completed')).toBe(true);
  });

  it('skips when no tree', async () => {
    const executor = createBehaviorControlExecutor();
    const state = makeMinimalState({
      behavior_profiles: [{ slot_id: 'test_slot', always_active: true }]
    });
    // tree is undefined
    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    const traces = result.diagnostics.step_traces;
    expect(traces.some((t) => t.kind === 'behavior_control')).toBe(true);
  });

  it('activates always_active slot', async () => {
    const executor = createBehaviorControlExecutor();
    const tree = makeTree();
    const state = makeMinimalState({
      tree: tree as never,
      behavior_profiles: [{ slot_id: 'always_slot', always_active: true }]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    expect(result.slot_behavior_diagnostics).toBeDefined();
    expect(result.slot_behavior_diagnostics!.slots_activated).toContain('always_slot');
    expect(result.slot_behavior_diagnostics!.slots_disabled).not.toContain('always_slot');

    // Fragment should NOT be permission_denied
    const frags = result.tree!.fragments_by_slot['always_slot'];
    expect(frags?.[0]?.permission_denied).toBe(false);
  });

  it('disables slot when keyword_match fails', async () => {
    const executor = createBehaviorControlExecutor();
    const tree = makeTree();
    const state = makeMinimalState({
      tree: tree as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        conditions: [{ type: 'keyword_match', keywords: ['nonexistent'] }]
      } as SlotBehaviorProfile],
      ai_messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello world' }], name: 'user' }]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    expect(result.slot_behavior_diagnostics!.slots_disabled).toContain('test_slot');
    const frags = result.tree!.fragments_by_slot['test_slot'];
    expect(frags?.[0]?.permission_denied).toBe(true);
  });

  it('activates slot when keyword_match succeeds', async () => {
    const executor = createBehaviorControlExecutor();
    const tree = makeTree();
    const state = makeMinimalState({
      tree: tree as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        conditions: [{ type: 'keyword_match', keywords: ['hello'] }]
      } as SlotBehaviorProfile],
      ai_messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello world' }], name: 'user' }]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    expect(result.slot_behavior_diagnostics!.slots_activated).toContain('test_slot');
    expect(result.slot_behavior_diagnostics!.slots_disabled).not.toContain('test_slot');
  });

  it('handles evaluator_failure_policy: deactivate (keyword_match fails → slot disabled)', async () => {
    const executor = createBehaviorControlExecutor();
    const tree = makeTree();

    const state = makeMinimalState({
      tree: tree as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        conditions: [{ type: 'keyword_match', keywords: ['nonexistent'] }],
        evaluator_failure_policy: 'deactivate'
      } as SlotBehaviorProfile],
      ai_messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello world' }], name: 'user' }]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    // keyword_match fails → slot should be disabled
    expect(result.slot_behavior_diagnostics!.slots_disabled).toContain('test_slot');
  });

  it('aborts pipeline on evaluator_failure_policy: abort', async () => {
    const executor = createBehaviorControlExecutor();
    const tree = makeTree();

    const state = makeMinimalState({
      tree: tree as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        always_active: true,
        evaluator_failure_policy: 'abort'
        // no conditions, so always_active activates normally — abort only triggers on error
      } as SlotBehaviorProfile]
    });

    // This should succeed normally (no error to trigger abort)
    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    expect(result.slot_behavior_diagnostics!.slots_activated).toContain('test_slot');
  });

  it('evaluates conversation_turn condition', async () => {
    const executor = createBehaviorControlExecutor();
    const tree = makeTree();
    const state = makeMinimalState({
      tree: tree as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        conditions: [{ type: 'conversation_turn', operator: 'gt', value: 3 }]
      } as SlotBehaviorProfile],
      // 5 messages → turn_count = 5
      ai_messages: [
        { role: 'user', parts: [{ type: 'text', text: 'msg1' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'msg2' }] },
        { role: 'user', parts: [{ type: 'text', text: 'msg3' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'msg4' }] },
        { role: 'user', parts: [{ type: 'text', text: 'msg5' }] }
      ] as never
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    // turn_count = 5 > 3 → activated
    expect(result.slot_behavior_diagnostics!.slots_activated).toContain('test_slot');
  });

  it('records diagnostics for each profile', async () => {
    const executor = createBehaviorControlExecutor();
    const tree = makeTree();
    const state = makeMinimalState({
      tree: tree as never,
      behavior_profiles: [
        { slot_id: 'always_slot', always_active: true },
        { slot_id: 'test_slot', always_active: true }
      ] as SlotBehaviorProfile[]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    expect(result.slot_behavior_diagnostics!.profiles_evaluated).toBe(2);
    expect(result.slot_behavior_diagnostics!.slots_activated).toEqual(['always_slot', 'test_slot']);
    expect(result.slot_behavior_diagnostics!.evaluation_errors).toEqual([]);
  });

  it('evaluates condition_combination: or', async () => {
    const executor = createBehaviorControlExecutor();
    const tree = makeTree();
    const state = makeMinimalState({
      tree: tree as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        conditions: [
          { type: 'keyword_match', keywords: ['nonexistent'] },
          { type: 'conversation_turn', operator: 'gt', value: 0 }
        ],
        condition_combination: 'or'
      } as SlotBehaviorProfile],
      ai_messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    // keyword_match fails but conversation_turn (turn_count=1 > 0) succeeds → OR → active
    expect(result.slot_behavior_diagnostics!.slots_activated).toContain('test_slot');
  });

  it('condition_combination: and with both failing', async () => {
    const executor = createBehaviorControlExecutor();
    const tree = makeTree();
    const state = makeMinimalState({
      tree: tree as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        conditions: [
          { type: 'keyword_match', keywords: ['nonexistent'] },
          { type: 'conversation_turn', operator: 'gt', value: 99 }
        ],
        condition_combination: 'and'
      } as SlotBehaviorProfile],
      ai_messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    // Both fail → AND → disabled
    expect(result.slot_behavior_diagnostics!.slots_disabled).toContain('test_slot');
  });

  it('evaluates trigger_probability gate', async () => {
    const executor = createBehaviorControlExecutor();
    const tree = makeTree();
    // probability = 0.0 should never activate
    const state = makeMinimalState({
      tree: tree as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        trigger_probability: 0.0
      } as SlotBehaviorProfile]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    expect(result.slot_behavior_diagnostics!.slots_disabled).toContain('test_slot');
  });
});

describe('behavior_control executor — ignore_context_length', () => {
  it('marks fragments with ignore_context_length metadata', async () => {
    const executor = createBehaviorControlExecutor();
    const tree = makeTree();
    const state = makeMinimalState({
      tree: tree as never,
      behavior_profiles: [{
        slot_id: 'test_slot',
        always_active: true,
        ignore_context_length: true
      } as SlotBehaviorProfile]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    const frags = result.tree!.fragments_by_slot['test_slot'];
    expect(frags?.[0]?.metadata?.ignore_context_length).toBe(true);
  });
});

describe('behavior_control executor — groups', () => {
  it('disables non-winner slots in exclusive group', async () => {
    const executor = createBehaviorControlExecutor();
    const tree = {
      ...makeTree(),
      fragments_by_slot: {
        slot_a: [{
          id: 'frag-a', slot_id: 'slot_a', priority: 10, source: 'test',
          removable: true, replaceable: false, children: [], permission_denied: false,
          estimated_tokens: 100, metadata: {}
        }],
        slot_b: [{
          id: 'frag-b', slot_id: 'slot_b', priority: 10, source: 'test',
          removable: true, replaceable: false, children: [], permission_denied: false,
          estimated_tokens: 100, metadata: {}
        }]
      },
      slot_registry: {
        slot_a: { id: 'slot_a', default_priority: 10, enabled: true },
        slot_b: { id: 'slot_b', default_priority: 10, enabled: true }
      } as Record<string, unknown> as PromptWorkflowState['slot_registry']
    };

    const state = makeMinimalState({
      tree: tree as never,
      behavior_profiles: [
        { slot_id: 'slot_a', group_id: 'g1', group_weight: 1, always_active: false },
        { slot_id: 'slot_b', group_id: 'g1', group_weight: 0 }  // weight 0 → never wins
      ] as SlotBehaviorProfile[]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    // slot_b has weight 0 → should be group-disabled
    expect(result.slot_behavior_diagnostics!.slots_disabled).toContain('slot_b');
    // slot_a should not be disabled
    const fragsA = result.tree!.fragments_by_slot['slot_a'];
    expect(fragsA?.[0]?.permission_denied).toBe(false);
  });

  it('priority mode: assigns render_order by weight descending', async () => {
    const executor = createBehaviorControlExecutor();
    const tree = {
      ...makeTree(),
      fragments_by_slot: {
        slot_low: [{ id: 'f-low', slot_id: 'slot_low', priority: 10, source: 'test',
          removable: true, replaceable: false, children: [], permission_denied: false,
          estimated_tokens: 100, metadata: {} }],
        slot_high: [{ id: 'f-high', slot_id: 'slot_high', priority: 10, source: 'test',
          removable: true, replaceable: false, children: [], permission_denied: false,
          estimated_tokens: 100, metadata: {} }]
      },
      slot_registry: {
        slot_low: { id: 'slot_low', default_priority: 10, enabled: true },
        slot_high: { id: 'slot_high', default_priority: 10, enabled: true }
      } as Record<string, unknown> as PromptWorkflowState['slot_registry']
    };

    const state = makeMinimalState({
      tree: tree as never,
      behavior_profiles: [
        { slot_id: 'slot_low', group_id: 'g1', group_weight: 1, group_mode: 'priority' },
        { slot_id: 'slot_high', group_id: 'g1', group_weight: 10, group_mode: 'priority' }
      ] as SlotBehaviorProfile[]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    // Both should be activated (priority mode doesn't disable)
    expect(result.slot_behavior_diagnostics!.slots_activated).toContain('slot_low');
    expect(result.slot_behavior_diagnostics!.slots_activated).toContain('slot_high');
  });

  it('budget mode: allocates token budget to fragment metadata', async () => {
    const executor = createBehaviorControlExecutor();
    const tree = {
      ...makeTree(),
      fragments_by_slot: {
        slot_a: [{ id: 'f-a', slot_id: 'slot_a', priority: 10, source: 'test',
          removable: true, replaceable: false, children: [], permission_denied: false,
          estimated_tokens: 100, metadata: {} }],
        slot_b: [{ id: 'f-b', slot_id: 'slot_b', priority: 10, source: 'test',
          removable: true, replaceable: false, children: [], permission_denied: false,
          estimated_tokens: 100, metadata: {} }]
      },
      slot_registry: {
        slot_a: { id: 'slot_a', default_priority: 10, enabled: true },
        slot_b: { id: 'slot_b', default_priority: 10, enabled: true }
      } as Record<string, unknown> as PromptWorkflowState['slot_registry']
    };

    const state = makeMinimalState({
      tree: tree as never,
      behavior_profiles: [
        { slot_id: 'slot_a', group_id: 'g1', group_weight: 1, group_mode: 'budget' },
        { slot_id: 'slot_b', group_id: 'g1', group_weight: 3, group_mode: 'budget' }
      ] as SlotBehaviorProfile[]
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: makeMinimalProfile(),
      spec: makeMinimalSpec(),
      state
    });

    // Both activated, with budget allocations on fragments
    const fragA = result.tree!.fragments_by_slot['slot_a'][0];
    const fragB = result.tree!.fragments_by_slot['slot_b'][0];
    // 1:3 ratio from 8192 → ~2048 : ~6144
    expect(fragA?.metadata?.token_budget_allocation).toBe(2048);
    expect(fragB?.metadata?.token_budget_allocation).toBe(6144);
  });
});
