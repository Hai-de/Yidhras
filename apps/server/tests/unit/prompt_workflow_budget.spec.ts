import { describe, expect, it } from 'vitest';

import { createTokenBudgetTrimExecutor } from '../../src/context/workflow/executors/token_budget_trim.js';
import { resolvePromptWorkflowBudget } from '../../src/context/workflow/token_budget.js';
import { createInitialPromptWorkflowState } from '../../src/context/workflow/types.js';
import type { PromptTokenCounter } from '../../src/inference/prompt_tokenizer.js';
import type { PromptFragmentV2 } from '../../src/inference/prompt_fragment_v2.js';
import type { PromptTree } from '../../src/inference/prompt_tree.js';
import type { InferenceContext } from '../../src/inference/types.js';

const createContext = (): InferenceContext => ({
  inference_id: 'inf-budget-001',
  actor_ref: { identity_id: 'agent-001', identity_type: 'agent', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
  actor_display_name: 'Agent One',
  identity: { id: 'agent-001', type: 'agent', name: 'Agent One', provider: null, status: null, claims: null },
  binding_ref: null,
  resolved_agent_id: 'agent-001',
  agent_snapshot: null,
  tick: 1n,
  agent_capabilities: [],
  strategy: 'model_routed',
  attributes: {},
  world_pack: { id: 'test-pack', name: 'Test Pack', version: '1.0.0' },
  world_prompts: {},
  world_ai: null,
  visible_variables: {},
  variable_context: { layers: [] },
  variable_context_summary: { namespaces: [], layer_count: 0 },
  policy_summary: { social_post_read_allowed: true, social_post_readable_fields: [], social_post_write_allowed: true, social_post_writable_fields: [] },
  transmission_profile: { policy: 'reliable', drop_reason: null, delay_ticks: '0', drop_chance: 0, derived_from: [] },
  context_run: { id: 'ctx-budget-001', created_at_tick: '1', selected_node_ids: [], nodes: [], diagnostics: { source_adapter_names: [], node_count: 0, node_counts_by_type: {}, selected_node_ids: [], dropped_nodes: [] } },
  memory_context: { short_term: [], long_term: [], summaries: [], diagnostics: { selected_count: 0, skipped_count: 0, memory_selection: { selected_entry_ids: [], dropped: [] } } },
  pack_state: { actor_roles: [], actor_state: null, owned_artifacts: [], world_state: null, latest_event: null },
  pack_runtime: { invocation_rules: [] }
});

const fragment = (id: string, slotId: string, tokens: number, removable = true): PromptFragmentV2 => ({
  id,
  slot_id: slotId,
  priority: tokens,
  source: 'test',
  removable,
  replaceable: false,
  estimated_tokens: tokens,
  children: [{ id: `${id}-block`, kind: 'text', content: { kind: 'text', text: id }, rendered: id, estimated_tokens: tokens }],
  anchor: null,
  placement_mode: null,
  depth: null,
  order: null
});

const createTree = (): PromptTree => ({
  inference_id: 'inf-budget-001',
  task_type: 'agent_decision',
  fragments_by_slot: {
    conversation_history: [fragment('old-conversation', 'conversation_history', 60), fragment('new-conversation', 'conversation_history', 60)],
    high_priority: [fragment('core', 'high_priority', 50, false)]
  },
  slot_registry: {
    conversation_history: { id: 'conversation_history', display_name: 'Conversation', default_priority: 10, include_in_combined: true, enabled: true },
    high_priority: { id: 'high_priority', display_name: 'High', default_priority: 100, include_in_combined: true, enabled: true }
  },
  resolved_positions: [
    { slot_id: 'high_priority', resolved_position: 100, resolution_source: 'explicit', enabled: true },
    { slot_id: 'conversation_history', resolved_position: 10, resolution_source: 'explicit', enabled: true }
  ],
  metadata: { prompt_version: 'test', profile_id: null, profile_version: null, source_prompt_keys: [] }
});

const counter: PromptTokenCounter = {
  async estimateTree(tree, safetyMargin = 0) {
    let total = safetyMargin;
    for (const fragments of Object.values(tree.fragments_by_slot)) {
      for (const f of fragments) {
        total += f.estimated_tokens ?? 0;
      }
    }
    return { total_tokens: total, by_slot: {}, safety_margin: safetyMargin };
  }
};

describe('prompt workflow budget', () => {
  it('resolves budget from step config before profile defaults', () => {
    const profile = {
      id: 'profile',
      version: '1',
      applies_to: { task_types: ['agent_decision'] },
      defaults: { token_budget: 100, safety_margin_tokens: 10 },
      steps: []
    };

    const resolved = resolvePromptWorkflowBudget({
      profile,
      spec: { key: 'budget', kind: 'token_budget_trim', config: { token_budget: 50, safety_margin_tokens: 5, model_context_window: 64 } }
    });

    expect(resolved).toMatchObject({ tokenBudget: 50, safetyMarginTokens: 5, effectiveBudget: 45, modelContextWindow: 64 });
    expect(resolved.sources.tokenBudget).toBe('step_config');
  });

  it('trims low priority conversation history before non-removable high priority content', async () => {
    const context = createContext();
    const profile = {
      id: 'profile',
      version: '1',
      applies_to: { task_types: ['agent_decision'] },
      defaults: { token_budget: 100, safety_margin_tokens: 0 },
      steps: []
    };
    const tree = createTree();
    const state = createInitialPromptWorkflowState({
      context_run: context.context_run,
      actor_ref: context.actor_ref,
      task_type: 'agent_decision',
      strategy: context.strategy,
      pack_id: context.world_pack.id,
      profile,
      tree
    });

    await createTokenBudgetTrimExecutor(counter).execute({
      context,
      profile,
      spec: { key: 'budget', kind: 'token_budget_trim' },
      state
    });

    const conversation = tree.fragments_by_slot.conversation_history;
    expect(conversation[0].id).toBe('old-conversation');
    expect(conversation[0].permission_denied).toBe(true);
    expect(tree.fragments_by_slot.high_priority[0].permission_denied).not.toBe(true);
  });
});
