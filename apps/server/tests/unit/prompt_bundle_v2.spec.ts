import { describe, expect, it } from 'vitest';

import { buildPromptBundleV2, buildPromptTree } from '../../src/inference/prompt_builder_v2.js';
import { walkPromptBlocks } from '../../src/inference/prompt_tree.js';
import type { InferenceContext, PromptResolvableContext } from '../../src/inference/types.js';

type PromptContext = InferenceContext | PromptResolvableContext;

const createMinimalContext = (): PromptContext => ({
  actor_ref: { identity_id: 'test-agent', identity_type: 'agent', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
  actor_display_name: 'Test Agent',
  identity: { id: 'test-agent', type: 'agent', name: 'Test Agent', provider: null, status: null, claims: null },
  binding_ref: null,
  resolved_agent_id: 'agent-001',
  agent_snapshot: null,
  tick: 1n,
  strategy: 'mock' as const,
  attributes: {},
  world_pack: { id: 'test-pack', name: 'Test Pack', version: '1.0.0' },
  world_prompts: {
    global_prefix: 'Welcome to Test World. Strategy: {{ request.strategy }}'
  },
  variable_context: { layers: [], alias_precedence: [], strict_namespace: false },
  variable_context_summary: { namespaces: [], alias_precedence: [], strict_namespace: false, layer_count: 0 },
  context_run: null,
  memory_context: null,
  pack_state: { actor_roles: [], actor_state: null, owned_artifacts: [], world_state: null, latest_event: null },
  pack_runtime: { invocation_rules: [] }
});

const SIMPLE_SLOT_REGISTRY = {
  system_core: {
    id: 'system_core',
    display_name: 'System Core',
    default_priority: 100,
    default_template: 'You are a test system.',
    message_role: 'system' as const,
    include_in_combined: true,
    combined_heading: 'System Prompt',
    enabled: true
  },
  role_core: {
    id: 'role_core',
    display_name: 'Role Core',
    default_priority: 90,
    default_template: 'You are {{ actor.display_name }}.',
    message_role: 'developer' as const,
    include_in_combined: true,
    combined_heading: 'Role Prompt',
    enabled: true
  },
  output_contract: {
    id: 'output_contract',
    display_name: 'Output Contract',
    default_priority: 50,
    default_template: 'Return JSON.',
    message_role: 'user' as const,
    include_in_combined: true,
    combined_heading: null,
    enabled: true
  }
};

describe('PromptBundleV2', () => {
  it('T1: buildPromptTree → buildPromptBundleV2 → slots have expected keys', () => {
    const ctx = createMinimalContext();
    const tree = buildPromptTree(ctx, SIMPLE_SLOT_REGISTRY);
    const v2 = buildPromptBundleV2(tree, ctx);

    expect(v2.slots).toHaveProperty('system_core');
    expect(v2.slots).toHaveProperty('role_core');
    expect(v2.slots).toHaveProperty('output_contract');
    expect(v2.slots['system_core']).toContain('test system');
    expect(v2.slots['role_core']).toContain('actor.display_name');
    expect(v2.combined_prompt.length).toBeGreaterThan(0);
    expect(v2.tree).toBeDefined();
  });


  it('T3: custom slot from registry appears in tree', () => {
    const ctx = createMinimalContext();
    const registry = {
      system_core: { ...SIMPLE_SLOT_REGISTRY.system_core },
      custom_slot: {
        id: 'custom_slot',
        display_name: 'Custom',
        default_priority: 50,
        default_template: 'Custom content.',
        message_role: 'user' as const,
        include_in_combined: true,
        combined_heading: 'Custom Slot',
        enabled: true
      }
    };

    const tree = buildPromptTree(ctx, registry);
    const v2 = buildPromptBundleV2(tree, ctx);

    expect(v2.slots).toHaveProperty('custom_slot');
    expect(v2.slots['custom_slot']).toContain('Custom content');
  });

  it('T4: disabled slot does not appear in bundle', () => {
    const ctx = createMinimalContext();
    const registry = {
      system_core: { ...SIMPLE_SLOT_REGISTRY.system_core },
      disabled_slot: {
        id: 'disabled_slot',
        display_name: 'Disabled',
        default_priority: 10,
        default_template: 'Should not appear.',
        message_role: 'user' as const,
        include_in_combined: true,
        combined_heading: 'Disabled',
        enabled: false
      }
    };

    const tree = buildPromptTree(ctx, registry);
    const v2 = buildPromptBundleV2(tree, ctx);

    expect(v2.slots).not.toHaveProperty('disabled_slot');
  });

  it('T5: walkPromptBlocks traverses nested conditional blocks', () => {
    const blockId = 'test-block';
    const fragment = {
      id: 'frag-1',
      slot_id: 'test_slot',
      priority: 100,
      source: 'test',
      removable: false,
      replaceable: false,
      children: [{
        id: blockId,
        kind: 'conditional' as const,
        content: {
          kind: 'conditional' as const,
          predicate_path: 'test.flag',
          children: [{
            id: 'inner-text',
            kind: 'text' as const,
            content: { kind: 'text' as const, text: 'nested content' },
            rendered: 'nested content'
          }]
        }
      }],
      anchor: null,
      placement_mode: null,
      depth: null,
      order: null
    };

    const visited: string[] = [];
    walkPromptBlocks([fragment], (block) => {
      visited.push(block.id);
    });

    expect(visited).toContain(blockId);
    expect(visited).toContain('inner-text');
  });

});
