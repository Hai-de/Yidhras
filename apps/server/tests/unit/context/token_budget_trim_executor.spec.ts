import { describe, expect, it } from 'vitest';

import { createTokenBudgetTrimExecutor } from '../../../src/context/workflow/executors/token_budget_trim.js';
import type {
  PromptWorkflowProfile,
  PromptWorkflowState,
  PromptWorkflowStepSpec
} from '../../../src/context/workflow/types.js';
import type { PromptFragmentV2 } from '../../../src/inference/prompt_fragment_v2.js';
import type { PromptSlotConfig } from '../../../src/inference/prompt_slot_config.js';
import type { PromptTokenCounter, TokenEstimate } from '../../../src/inference/prompt_tokenizer.js';
import type { PromptTree } from '../../../src/inference/prompt_tree.js';
import { expectArrayElement, expectDefined } from '../../helpers/assertions.js';

const SLOT_SYSTEM: PromptSlotConfig = {
  id: 'system_core',
  display_name: 'Test Slot',
  default_priority: 100,
  enabled: true,
  include_in_combined: true
};

const SLOT_MEMORY: PromptSlotConfig = {
  id: 'memory_short_term',
  display_name: 'Test Slot',
  default_priority: 50,
  enabled: true,
  include_in_combined: true
};

const SLOT_LOW: PromptSlotConfig = {
  id: 'post_process',
  display_name: 'Test Slot',
  default_priority: 10,
  enabled: true,
  include_in_combined: true
};

const buildFragment = (overrides: Partial<PromptFragmentV2> = {}): PromptFragmentV2 => ({
  id: overrides.id ?? 'frag-1',
  slot_id: overrides.slot_id ?? 'system_core',
  priority: overrides.priority ?? 100,
  source: overrides.source ?? 'test',
  removable: overrides.removable ?? true,
  replaceable: overrides.replaceable ?? false,
  children: overrides.children ?? [],
  estimated_tokens: overrides.estimated_tokens,
  permission_denied: overrides.permission_denied ?? false,
  metadata: overrides.metadata
});

const buildTree = (fragmentsBySlot: Record<string, PromptFragmentV2[]>): PromptTree => ({
  inference_id: 'test-id',
  task_type: 'agent_decision',
  fragments_by_slot: fragmentsBySlot,
  resolved_positions: [],
  slot_registry: {
    system_core: SLOT_SYSTEM,
    memory_short_term: SLOT_MEMORY,
    post_process: SLOT_LOW
  },
  metadata: {
    prompt_version: '2',
    profile_id: 'agent-decision-default',
    profile_version: '1',
    source_prompt_keys: ['slot_config:system_core']
  }
});

const buildProfile = (overrides: {
  token_budget?: number;
  safety_margin_tokens?: number;
} = {}): PromptWorkflowProfile => ({
  id: 'agent-decision-default',
  version: '1',
  applies_to: { task_types: ['agent_decision'] },
  defaults: {
    token_budget: overrides.token_budget ?? 2200,
    safety_margin_tokens: overrides.safety_margin_tokens ?? 80
  },
  steps: [{ key: 'budget_trim', kind: 'token_budget_trim' }]
});

const buildSpec = (config?: Record<string, unknown>): PromptWorkflowStepSpec => ({
  key: 'budget_trim',
  kind: 'token_budget_trim',
  config
});

const buildState = (tree: PromptTree, profile?: PromptWorkflowProfile): PromptWorkflowState => ({
  context_run: { id: 'ctx-1', created_at_tick: '0', nodes: [], selected_node_ids: [], diagnostics: { source_adapter_names: [], node_count: 0, node_counts_by_type: {}, selected_node_ids: [], dropped_nodes: [] } },
  actor_ref: { identity_id: 'a1', identity_type: 'agent', role: 'active', agent_id: 'a1', atmosphere_node_id: null },
  task_type: 'agent_decision',
  strategy: 'mock',
  pack_id: 'test_pack',
  profile: profile ?? buildProfile(),
  selected_nodes: [],
  working_set: [],
  grouped_nodes: {},
  section_drafts: [],
  tree,
  diagnostics: {
    profile_id: profile?.id ?? 'agent-decision-default',
    profile_version: '1',
    selected_step_keys: ['budget_trim'],
    step_traces: []
  }
});

const createMockCounter = (overrides?: {
  totalTokens?: number;
  safetyMargin?: number;
}): PromptTokenCounter => ({
  async estimateTree(tree: PromptTree): Promise<TokenEstimate> {
    const safetyMargin = overrides?.safetyMargin ?? 80;
    const bySlot: Record<string, { total: number; by_fragment: Record<string, number> }> = {};
    for (const [slotId, fragments] of Object.entries(tree.fragments_by_slot)) {
      const byFragment: Record<string, number> = {};
      let slotTotal = 0;
      for (const fragment of fragments) {
        const tokens = fragment.estimated_tokens ?? 0;
        byFragment[fragment.id] = tokens;
        slotTotal += tokens;
      }
      bySlot[slotId] = { total: slotTotal, by_fragment: byFragment };
    }

    const rawTotal = Object.values(bySlot).reduce((sum, s) => sum + s.total, 0);
    return {
      total_tokens: overrides?.totalTokens ?? (rawTotal + safetyMargin),
      safety_margin: safetyMargin,
      by_slot: bySlot
    };
  }
});

const fragmentsOf = (state: PromptWorkflowState, slotId: string) =>
  expectDefined(expectDefined(state.tree, 'prompt tree').fragments_by_slot[slotId], `${slotId} fragments`);

describe('createTokenBudgetTrimExecutor', () => {
  const execute = (state: PromptWorkflowState, profile?: PromptWorkflowProfile, config?: Record<string, unknown>) => {
    const executor = createTokenBudgetTrimExecutor(createMockCounter());
    return executor.execute({
      context: state as unknown as Parameters<typeof executor.execute>[0]['context'],
      profile: profile ?? state.profile,
      spec: buildSpec(config),
      state
    });
  };

  it('does not trim when total tokens are within budget', async () => {
    const profile = buildProfile({ token_budget: 10000 });
    const tree = buildTree({
      system_core: [buildFragment({ id: 'f1', slot_id: 'system_core', estimated_tokens: 100, removable: true })]
    });
    const state = buildState(tree, profile);

    await execute(state);

    const fragment = expectArrayElement(fragmentsOf(state, 'system_core'), 0, 'system_core fragments');
    expect(fragment.permission_denied).toBe(false);
  });

  it('trims removable fragments when budget is exceeded', async () => {
    const profile = buildProfile({ token_budget: 100, safety_margin_tokens: 0 });
    const tree = buildTree({
      system_core: [buildFragment({ id: 'f1', slot_id: 'system_core', estimated_tokens: 50, removable: true })],
      post_process: [
        buildFragment({ id: 'f2', slot_id: 'post_process', estimated_tokens: 70, removable: true }),
        buildFragment({ id: 'f3', slot_id: 'post_process', estimated_tokens: 70, removable: true })
      ]
    });
    const state = buildState(tree, profile);

    await execute(state);

    // Slots sorted by priority ascending: post_process (10) → system_core (100).
    // f2 (70 tokens): remaining 100 > 0 → remaining = 100 - 70 = 30
    // f3 (70 tokens): remaining 30 > 0 → remaining = 30 - 70 = -40
    // f1 (50 tokens): remaining -40 <= 0 AND removable → denied
    const f1 = expectArrayElement(fragmentsOf(state, 'system_core'), 0, 'system_core fragments');
    expect(f1.permission_denied).toBe(true);
    expect(f1.denial).toEqual([{ source: 'token_budget_trim', reason: 'trimmed_by_token_budget' }]);
  });

  it('does not trim at exact budget boundary', async () => {
    const profile = buildProfile({ token_budget: 300, safety_margin_tokens: 0 });
    const tree = buildTree({
      system_core: [buildFragment({ id: 'f1', slot_id: 'system_core', estimated_tokens: 300, removable: true })]
    });
    const state = buildState(tree, profile);
    const counter = createMockCounter({ totalTokens: 300, safetyMargin: 0 });
    const executor = createTokenBudgetTrimExecutor(counter);

    await executor.execute({
      context: state as unknown as Parameters<typeof executor.execute>[0]['context'],
      profile,
      spec: buildSpec(),
      state
    });

    const fragment = expectArrayElement(fragmentsOf(state, 'system_core'), 0, 'system_core fragments');
    expect(fragment.permission_denied).toBe(false);
  });

  it('never trims non-removable fragments even when budget is exhausted', async () => {
    const profile = buildProfile({ token_budget: 10, safety_margin_tokens: 0 });
    const tree = buildTree({
      // post_process has lower priority (10), processed first. Its non-removable
      // fragment exhausts the budget without being denied.
      post_process: [buildFragment({ id: 'f1', slot_id: 'post_process', estimated_tokens: 500, removable: false })],
      // system_core has higher priority (100), processed second. Budget already
      // exhausted, so this removable fragment gets denied.
      system_core: [buildFragment({ id: 'f2', slot_id: 'system_core', estimated_tokens: 100, removable: true })]
    });
    const state = buildState(tree, profile);

    await execute(state);

    const nonRemovable = expectArrayElement(fragmentsOf(state, 'post_process'), 0, 'post_process fragments');
    expect(nonRemovable.permission_denied).toBe(false);

    const removable = expectArrayElement(fragmentsOf(state, 'system_core'), 0, 'system_core fragments');
    expect(removable.permission_denied).toBe(true);
  });

  it('spec.config overrides profile defaults', async () => {
    const profile = buildProfile({ token_budget: 10000 });
    const tree = buildTree({
      system_core: [buildFragment({ id: 'f1', slot_id: 'system_core', estimated_tokens: 100, removable: true })],
      post_process: [buildFragment({ id: 'f2', slot_id: 'post_process', estimated_tokens: 200, removable: true })]
    });
    const state = buildState(tree, profile);

    await execute(state, undefined, { token_budget: 50, safety_margin_tokens: 0 });

    // effectiveBudget = 50. post_process (priority 10) first: f2 consumes 200 tokens.
    // system_core (priority 100) second: remaining <= 0, f1 gets denied.
    const sysFrag = expectArrayElement(fragmentsOf(state, 'system_core'), 0, 'system_core fragments');
    expect(sysFrag.permission_denied).toBe(true);
  });

  it('handles empty tree without error', async () => {
    const profile = buildProfile();
    const tree = buildTree({});
    const state = buildState(tree, profile);

    await expect(execute(state)).resolves.toBeDefined();
  });

  it('records step trace in diagnostics', async () => {
    const profile = buildProfile({ token_budget: 10000 });
    const tree = buildTree({
      system_core: [buildFragment({ id: 'f1', slot_id: 'system_core', estimated_tokens: 10, removable: true })]
    });
    const state = buildState(tree, profile);

    await execute(state);

    expect(state.diagnostics.step_traces).toHaveLength(1);
    const trace = expectArrayElement(state.diagnostics.step_traces, 0, 'step traces');
    expect(trace.key).toBe('budget_trim');
    expect(trace.kind).toBe('token_budget_trim');
    expect(trace.status).toBe('completed');
    const notes = expectDefined(trace.notes, 'trace notes');
    expect(notes.trimmed).toBe(false);
  });
});
