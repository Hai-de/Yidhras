import { describe, expect, it } from 'vitest';

import { createBehaviorControlExecutor } from '../../../src/context/workflow/executors/behavior_control.js';
import { createInitialPromptWorkflowState } from '../../../src/context/workflow/types.js';
import type { PromptFragmentV2 } from '../../../src/inference/prompt_fragment_v2.js';
import type { PromptTree } from '../../../src/inference/prompt_tree.js';
import type { InferenceContext } from '../../../src/inference/types.js';

const createContext = (): InferenceContext => ({
  inference_id: 'inf-behavior-001',
  actor_ref: { identity_id: 'agent-001', identity_type: 'agent', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
  actor_display_name: 'Agent One',
  identity: { id: 'agent-001', type: 'agent', name: 'Agent One', provider: null, status: null, claims: null },
  binding_ref: null,
  resolved_agent_id: 'agent-001',
  agent_snapshot: null,
  tick: 10n,
  agent_capabilities: [],
  strategy: 'model_routed',
  attributes: {},
  world_pack: { id: 'test-pack', name: 'Test Pack', version: '1.0.0' },
  world_prompts: {},
  world_ai: null,
  visible_variables: {},
  variable_context: { layers: [] },
  variable_context_summary: { namespaces: [], layer_count: 0 },
  policy_summary: {
    social_post_read_allowed: true,
    social_post_readable_fields: [],
    social_post_write_allowed: true,
    social_post_writable_fields: []
  },
  transmission_profile: { policy: 'reliable', drop_reason: null, delay_ticks: '0', drop_chance: 0, derived_from: [] },
  context_run: { id: 'ctx-1', created_at_tick: '10', selected_node_ids: [], nodes: [], diagnostics: { source_adapter_names: [], node_count: 0, node_counts_by_type: {}, selected_node_ids: [], dropped_nodes: [] } },
  memory_context: { short_term: [], long_term: [], summaries: [], diagnostics: { selected_count: 0, skipped_count: 0, memory_selection: { selected_entry_ids: [], dropped: [] } } },
  pack_state: { actor_roles: [], actor_state: null, owned_artifacts: [], world_state: null, latest_event: null, recent_events: [] },
  pack_runtime: { invocation_rules: [] },
  current_agent_id: 'agent-001',
  agent_conversation_memory: {
    id: 'mem-1',
    owner_agent_id: 'agent-001',
    conversation_id: 'conv-1',
    entries: [
      {
        id: 'entry-1',
        turn_number: 1,
        speaker_agent_id: 'agent-002',
        kind: 'original',
        original_content: '秘密关键词出现了',
        current_content: '秘密关键词出现了',
        provenance: { operator: { kind: 'agent', id: 'agent-002' }, capability: 'conversation.record' },
        recorded_at: 1,
        modifications: []
      }
    ]
  }
});

const createTree = (fragment: PromptFragmentV2): PromptTree => ({
  inference_id: 'inf-behavior-001',
  task_type: 'agent_decision',
  fragments_by_slot: { behavior_slot: [fragment] },
  slot_registry: {
    behavior_slot: {
      id: 'behavior_slot',
      display_name: 'Behavior Slot',
      default_priority: 50,
      message_role: 'user',
      include_in_combined: true,
      enabled: true
    }
  },
  resolved_positions: [{ slot_id: 'behavior_slot', resolved_position: 50, resolution_source: 'explicit', enabled: true }],
  metadata: { prompt_version: 'test', profile_id: null, profile_version: null, source_prompt_keys: [] }
});

const createFragment = (): PromptFragmentV2 => ({
  id: 'fragment-1',
  slot_id: 'behavior_slot',
  priority: 50,
  source: 'test',
  removable: true,
  replaceable: false,
  estimated_tokens: 10,
  children: [{ id: 'block-1', kind: 'text', content: { kind: 'text', text: 'content' }, rendered: 'content' }],
  anchor: null,
  placement_mode: null,
  depth: null,
  order: null
});

describe('behavior_control executor', () => {
  it('evaluates conversation_turn and keyword_match from InferenceContext conversation memory', async () => {
    const context = createContext();
    const fragment = createFragment();
    const profile = {
      id: 'test-profile',
      version: '1',
      applies_to: { task_types: ['agent_decision'] },
      defaults: { token_budget: 100, safety_margin_tokens: 10 },
      steps: []
    };
    const state = createInitialPromptWorkflowState({
      context_run: context.context_run,
      actor_ref: context.actor_ref,
      task_type: 'agent_decision',
      strategy: context.strategy,
      pack_id: context.world_pack.id,
      profile,
      tree: createTree(fragment)
    });
    state.behavior_profiles = [
      {
        slot_id: 'behavior_slot',
        conditions: [
          { type: 'conversation_turn', operator: 'gte', value: 1 },
          { type: 'keyword_match', keywords: ['秘密关键词'], match_mode: 'any' }
        ],
        condition_combination: 'and'
      }
    ];

    const resultState = await createBehaviorControlExecutor().execute({
      context,
      profile,
      spec: { key: 'behavior', kind: 'behavior_control' },
      state
    });

    expect(resultState.slot_behavior_diagnostics?.slots_activated).toContain('behavior_slot');
    expect(fragment.permission_denied).not.toBe(true);
  });

  it('disables slot when keyword_match does not match conversation memory', async () => {
    const context = createContext();
    const fragment = createFragment();
    const profile = {
      id: 'test-profile',
      version: '1',
      applies_to: { task_types: ['agent_decision'] },
      defaults: { token_budget: 100, safety_margin_tokens: 10 },
      steps: []
    };
    const state = createInitialPromptWorkflowState({
      context_run: context.context_run,
      actor_ref: context.actor_ref,
      task_type: 'agent_decision',
      strategy: context.strategy,
      pack_id: context.world_pack.id,
      profile,
      tree: createTree(fragment)
    });
    state.behavior_profiles = [
      {
        slot_id: 'behavior_slot',
        conditions: [{ type: 'keyword_match', keywords: ['不存在的词'], match_mode: 'any' }]
      }
    ];

    const resultState = await createBehaviorControlExecutor().execute({
      context,
      profile,
      spec: { key: 'behavior', kind: 'behavior_control' },
      state
    });

    expect(resultState.slot_behavior_diagnostics?.slots_disabled).toContain('behavior_slot');
    expect(fragment.permission_denied).toBe(true);
  });
});
