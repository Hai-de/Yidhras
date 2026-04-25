import { describe, expect, it } from 'vitest';

import { buildPromptTree } from '../../src/inference/prompt_builder_v2.js';
import type { PromptFragmentV2 } from '../../src/inference/prompt_fragment_v2.js';
import { aggregateFragmentTokens, aggregateTreeTokens,createPromptTokenCounter } from '../../src/inference/prompt_tokenizer.js';
import { createTiktokenTokenizer } from '../../src/inference/tokenizers/tiktoken_adapter.js';
import type { InferenceContext } from '../../src/inference/types.js';

const BASE_CTX = {
  actor_ref: { identity_id: 'actor-001', identity_type: 'agent', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
  actor_display_name: 'Test',
  identity: { id: 'actor-001', type: 'agent', name: 'Test', provider: null, status: null, claims: null },
  binding_ref: null,
  resolved_agent_id: 'agent-001',
  agent_snapshot: null,
  tick: 1n,
  strategy: 'mock' as const,
  attributes: {},
  world_pack: { id: 'test', name: 'Test', version: '1' },
  world_prompts: {},
  variable_context: { layers: [], alias_precedence: [], strict_namespace: false },
  variable_context_summary: { namespaces: [], alias_precedence: [], strict_namespace: false, layer_count: 0 },
  context_run: null,
  memory_context: null,
  pack_state: { actor_roles: [], actor_state: null, owned_artifacts: [], world_state: null, latest_event: null },
  pack_runtime: { invocation_rules: [] }
} as unknown as InferenceContext;

describe('prompt tokenizer', () => {
  it('T1: count returns correct token count', () => {
    const tokenizer = createTiktokenTokenizer();
    const count = tokenizer.count('Hello world');
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThan(0);
  });

  it('T2: slice returns first N tokens', () => {
    const tokenizer = createTiktokenTokenizer();
    const text = 'Hello world this is a test of the tokenizer';
    const full = tokenizer.count(text);
    const sliced = tokenizer.slice(text, 3);
    const slicedCount = tokenizer.count(sliced);
    expect(slicedCount).toBeLessThanOrEqual(3);
    expect(slicedCount).toBeLessThan(full);
  });

  it('T3: estimateTree fills estimated_tokens on all blocks', async () => {
    const registry = {
      system_core: {
        id: 'system_core',
        display_name: 'System',
        default_priority: 100,
        default_template: 'You are a helpful assistant. Return JSON decisions.',
        message_role: 'system' as const,
        include_in_combined: true,
        combined_heading: 'System',
        enabled: true
      }
    };
    const tree = buildPromptTree(BASE_CTX, registry);
    const tokenizer = createTiktokenTokenizer();
    const counter = createPromptTokenCounter(tokenizer);
    const estimate = await counter.estimateTree(tree);

    expect(estimate.total_tokens).toBeGreaterThan(0);
    expect(estimate.by_slot).toHaveProperty('system_core');

    for (const fragments of Object.values(tree.fragments_by_slot)) {
      for (const fragment of fragments) {
        for (const child of fragment.children) {
          if ('kind' in child) {
            const block = child as { estimated_tokens?: number };
            expect(typeof block.estimated_tokens).toBe('number');
          }
        }
      }
    }
  });

  it('T4: token_encoding is set consistently across blocks', async () => {
    const registry = {
      system_core: {
        id: 'system_core',
        display_name: 'System',
        default_priority: 100,
        default_template: 'System message',
        message_role: 'system' as const,
        include_in_combined: true,
        combined_heading: 'System',
        enabled: true
      }
    };
    const tree = buildPromptTree(BASE_CTX, registry);
    const tokenizer = createTiktokenTokenizer();
    const counter = createPromptTokenCounter(tokenizer);
    await counter.estimateTree(tree);

    for (const fragments of Object.values(tree.fragments_by_slot)) {
      for (const fragment of fragments) {
        for (const child of fragment.children) {
          if ('kind' in child) {
            const block = child as { token_encoding?: string };
            expect(block.token_encoding).toBe('cl100k_base');
          }
        }
      }
    }
  });

  it('T5: aggregateFragmentTokens recursively sums nested fragments', () => {
    const fragment: PromptFragmentV2 = {
      id: 'parent',
      slot_id: 'test',
      priority: 100,
      source: 'test',
      removable: false,
      replaceable: false,
      children: [
        { id: 'b1', kind: 'text', content: { kind: 'text', text: 'a' }, estimated_tokens: 5 },
        {
          id: 'child',
          slot_id: 'test',
          priority: 90,
          source: 'test',
          removable: false,
          replaceable: false,
          children: [
            { id: 'b2', kind: 'text', content: { kind: 'text', text: 'b' }, estimated_tokens: 3 }
          ]
        } as unknown as PromptFragmentV2
      ]
    };

    const total = aggregateFragmentTokens(fragment);
    expect(total).toBe(8);
    expect(fragment.estimated_tokens).toBe(8);
  });

  it('T6: safety_margin is added to total_tokens', async () => {
    const registry = {
      system_core: {
        id: 'system_core',
        display_name: 'System',
        default_priority: 100,
        default_template: 'Short message.',
        message_role: 'system' as const,
        include_in_combined: true,
        combined_heading: 'System',
        enabled: true
      }
    };
    const tree = buildPromptTree(BASE_CTX, registry);
    const counter = createPromptTokenCounter(createTiktokenTokenizer());

    const withMargin = await counter.estimateTree(tree, 100);
    const noMargin = await counter.estimateTree(tree, 0);
    expect(withMargin.total_tokens).toBe(noMargin.total_tokens + 100);
    expect(withMargin.safety_margin).toBe(100);
    expect(noMargin.safety_margin).toBe(0);
  });
});
