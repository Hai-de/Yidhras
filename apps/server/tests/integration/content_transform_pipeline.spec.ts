import { afterEach, describe, expect, it } from 'vitest';

import { createContentTransformExecutor } from '../../src/context/workflow/executors/content_transform.js';
import { createInitialPromptWorkflowState } from '../../src/context/workflow/types.js';
import type { PromptWorkflowState, PromptWorkflowStepSpec } from '../../src/context/workflow/types.js';
import { slotContentTransformRegistry } from '../../src/plugins/extensions/slot_content_transformer.js';

// ── helpers ──

function makeTreeWithContent(slotId: string, content: string, estimatedTokens = 100) {
  return {
    inference_id: 'inf-test',
    task_type: 'agent_decision',
    fragments_by_slot: {
      [slotId]: [{
        id: 'frag-1', slot_id: slotId, priority: 10, source: 'test',
        removable: true, replaceable: false,
        children: [{ kind: 'text', rendered: content }],
        permission_denied: false, estimated_tokens: estimatedTokens, metadata: {}
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
    context_run: { run_id: 'run-1', nodes: [], created_at: BigInt(0), metadata: {} },
    actor_ref: { actor_entity_id: 'e1', actor_role: 'active' },
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
    context_run: { run_id: 'run-1', nodes: [], created_at: BigInt(0), metadata: {} },
    memory_context: { pack_id: 'test-pack', memory_blocks: [], overlays: [], metadata: {} },
    pack_runtime: {},
    world_pack: { id: 'test-pack', name: 'Test', version: '1' },
    actor_ref: { actor_entity_id: 'e1', actor_role: 'active' as const },
    actor_display_name: 'Test', identity: { identity_id: 'id1', name: 'Test', type: 'agent' as const },
    binding_ref: null, resolved_agent_id: null, agent_snapshot: null,
    pack_state: { entities: {}, relationships: [] },
    visible_variables: {},
    policy_summary: { allowed_actions: [], permissions: [] },
    transmission_profile: { max_tokens: 4096, temperature: 0.7 }
  };
}

const minimalProfile = { id: 'p', version: '1', applies_to: {}, steps: [] };
const minimalSpec: PromptWorkflowStepSpec = { key: 'transform', kind: 'content_transform' };

// ── tests ──

describe('content_transform executor', () => {
  afterEach(() => {
    slotContentTransformRegistry.clear();
  });

  it('skips when no tree', async () => {
    const executor = createContentTransformExecutor();
    const state = makeMinimalState();

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: minimalProfile as never,
      spec: minimalSpec,
      state
    });

    const traces = result.diagnostics.step_traces;
    const transformTrace = traces.find((t) => t.kind === 'content_transform');
    expect(transformTrace).toBeDefined();
    expect(transformTrace!.notes).toMatchObject({ skipped: true, reason: 'no tree' });
  });

  it('skips when no transformers registered', async () => {
    const executor = createContentTransformExecutor();
    const state = makeMinimalState({
      tree: makeTreeWithContent('slot_a', 'original text') as never
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: minimalProfile as never,
      spec: minimalSpec,
      state
    });

    const traces = result.diagnostics.step_traces;
    expect(traces.some((t) => t.kind === 'content_transform' && t.notes?.skipped)).toBe(true);
  });

  it('transforms content of activated slots', async () => {
    slotContentTransformRegistry.register('test-pack', {
      key: 'slot_transform.uppercase',
      version: '1.0.0',
      transform: async (content) => ({ transformed: content.toUpperCase() })
    });

    const executor = createContentTransformExecutor();
    const state = makeMinimalState({
      tree: makeTreeWithContent('slot_a', 'hello world') as never,
      slot_behavior_diagnostics: {
        profiles_evaluated: 1,
        slots_activated: ['slot_a'],
        slots_disabled: [],
        evaluation_errors: []
      }
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: minimalProfile as never,
      spec: minimalSpec,
      state
    });

    const frags = result.tree!.fragments_by_slot['slot_a'];
    const child = frags?.[0]?.children?.[0] as { rendered?: string } | undefined;
    expect(child?.rendered).toBe('HELLO WORLD');
  });

  it('does not transform disabled slots', async () => {
    slotContentTransformRegistry.register('test-pack', {
      key: 'slot_transform.append',
      version: '1.0.0',
      transform: async (content) => ({ transformed: content + '!' })
    });

    const executor = createContentTransformExecutor();
    const state = makeMinimalState({
      tree: makeTreeWithContent('disabled_slot', 'original') as never,
      slot_behavior_diagnostics: {
        profiles_evaluated: 1,
        slots_activated: ['other_slot'],
        slots_disabled: ['disabled_slot'],
        evaluation_errors: []
      }
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: minimalProfile as never,
      spec: minimalSpec,
      state
    });

    // Content of disabled slot should remain unchanged
    const frags = result.tree!.fragments_by_slot['disabled_slot'];
    const child = frags?.[0]?.children?.[0] as { rendered?: string } | undefined;
    expect(child?.rendered).toBe('original');
  });

  it('chains multiple transformers in registration order', async () => {
    slotContentTransformRegistry.register('test-pack', {
      key: 'slot_transform.upper',
      version: '1.0.0',
      transform: async (content) => ({ transformed: content.toUpperCase() })
    });
    slotContentTransformRegistry.register('test-pack', {
      key: 'slot_transform.bang',
      version: '1.0.0',
      transform: async (content) => ({ transformed: content + '!!!' })
    });

    const executor = createContentTransformExecutor();
    const state = makeMinimalState({
      tree: makeTreeWithContent('slot_a', 'hello') as never,
      slot_behavior_diagnostics: {
        profiles_evaluated: 1,
        slots_activated: ['slot_a'],
        slots_disabled: [],
        evaluation_errors: []
      }
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: minimalProfile as never,
      spec: minimalSpec,
      state
    });

    // First uppercase, then bang → 'HELLO!!!'
    const frags = result.tree!.fragments_by_slot['slot_a'];
    const child = frags?.[0]?.children?.[0] as { rendered?: string } | undefined;
    expect(child?.rendered).toBe('HELLO!!!');
  });

  it('handles transformer error gracefully (keeps original content)', async () => {
    slotContentTransformRegistry.register('test-pack', {
      key: 'slot_transform.broken',
      version: '1.0.0',
      transform: async () => { throw new Error('transform failed'); }
    });

    const executor = createContentTransformExecutor();
    const state = makeMinimalState({
      tree: makeTreeWithContent('slot_a', 'important content') as never,
      slot_behavior_diagnostics: {
        profiles_evaluated: 1,
        slots_activated: ['slot_a'],
        slots_disabled: [],
        evaluation_errors: []
      }
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: minimalProfile as never,
      spec: minimalSpec,
      state
    });

    // Content preserved despite error
    const frags = result.tree!.fragments_by_slot['slot_a'];
    const child = frags?.[0]?.children?.[0] as { rendered?: string } | undefined;
    expect(child?.rendered).toBe('important content');
  });

  it('records trace with transformer count', async () => {
    slotContentTransformRegistry.register('test-pack', {
      key: 'slot_transform.t1',
      version: '1.0.0',
      transform: async (content) => ({ transformed: content + '_mod' })
    });

    const executor = createContentTransformExecutor();
    const state = makeMinimalState({
      tree: makeTreeWithContent('slot_a', 'text') as never,
      slot_behavior_diagnostics: {
        profiles_evaluated: 1,
        slots_activated: ['slot_a'],
        slots_disabled: [],
        evaluation_errors: []
      }
    });

    const result = await executor.execute({
      context: makeMinimalContext() as never,
      profile: minimalProfile as never,
      spec: minimalSpec,
      state
    });

    const trace = result.diagnostics.step_traces.find((t) => t.kind === 'content_transform');
    expect(trace).toBeDefined();
    expect(trace!.notes).toMatchObject({
      transformers_available: 1,
      fragments_transformed: 1
    });
  });
});
