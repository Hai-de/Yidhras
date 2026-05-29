import { describe, expect, it } from 'vitest';

import { runTemplateTrack } from '../../../src/context/workflow/tracks/template_track.js';
import type { PromptSlotConfig } from '../../../src/inference/prompt_slot_config.js';
import { resolveSlotPositions } from '../../../src/inference/slot_position_resolver.js';
import type { InferenceContext } from '../../../src/inference/types.js';

const buildContext = (overrides: Partial<InferenceContext> = {}): InferenceContext =>
  ({
    inference_id: 'test-1',
    tick: 42n,
    strategy: 'mock',
    actor_ref: { actor_id: 'a1', actor_type: 'agent', role: 'protagonist', agent_id: 'ag1', identity_id: 'id1', actor_label: 'Test' },
    actor_display_name: 'Test Actor',
    resolved_agent_id: 'ag1',
    variable_context: { layers: [], alias_values: {} },
    world_prompts: { global_prefix: 'World prefix text' },
    pack_state: { actor_roles: [], owned_artifacts: [], world_state: null, latest_event: null, actor_state: null },
    identity: { id: 'id1', type: 'agent' },
    binding_ref: {},
    world_pack: { id: 'wp1', name: 'test', version: '1' },
    context_run: null,
    memory_context: null,
    attributes: {},
    pack_runtime: { invocation_rules: [] },
    ...overrides
  } as unknown as InferenceContext);

const buildSlot = (overrides: Partial<PromptSlotConfig> = {}): PromptSlotConfig => ({
  id: 'test_slot',
  display_name: 'Test Slot',
  default_priority: 50,
  include_in_combined: true,
  enabled: true,
  ...overrides
});

describe('runTemplateTrack', () => {
  it('produces section_draft with expanded macros for slots with default_template', () => {
    const slot = buildSlot({
      id: 'system_core',
      default_template: 'Strategy: {{ strategy }}',
      default_priority: 100
    });
    const context = buildContext({ strategy: 'mock' });
    const registry: Record<string, PromptSlotConfig> = { system_core: slot };

    const { result, trace } = runTemplateTrack(registry, resolveSlotPositions(registry).resolved_positions, context);

    expect(result).toHaveLength(1);
    const draft = result[0];
    expect(draft.track).toBe('template');
    expect(draft.section_type).toBe('system_instruction');
    expect(draft.slot).toBe('system_core');
    expect(draft.priority).toBe(100);
    expect(draft.removable).toBe(false);
    expect(draft.source_node_ids).toEqual([]);
    expect(draft.content_blocks[0]).toMatchObject({ kind: 'text' });
    expect((draft.content_blocks[0] as { kind: string; text?: string }).text).toBe('Strategy: mock');

    expect(trace.track).toBe('template');
    expect(trace.output_summary.section_drafts_count).toBe(1);
  });

  it('skips slots without templates', () => {
    const slot = buildSlot({ id: 'memory_short_term', default_priority: 50 });
    const context = buildContext();
    const registry: Record<string, PromptSlotConfig> = { memory_short_term: slot };

    const { result } = runTemplateTrack(registry, resolveSlotPositions(registry).resolved_positions, context);

    expect(result).toHaveLength(0);
  });

  it('skips disabled slots', () => {
    const slot = buildSlot({
      id: 'system_core',
      default_template: 'Should not appear',
      enabled: false
    });
    const context = buildContext();
    const registry: Record<string, PromptSlotConfig> = { system_core: slot };

    const { result } = runTemplateTrack(registry, resolveSlotPositions(registry).resolved_positions, context);

    expect(result).toHaveLength(0);
  });

  it('handles world_context slot from world_prompts.global_prefix', () => {
    const slot = buildSlot({
      id: 'world_context',
      template_context: 'world_prompts',
      default_priority: 70
    });
    const context = buildContext();
    const registry: Record<string, PromptSlotConfig> = { world_context: slot };

    const { result } = runTemplateTrack(registry, resolveSlotPositions(registry).resolved_positions, context);

    expect(result).toHaveLength(1);
    expect(result[0].section_type).toBe('world_context');
    expect(result[0].slot).toBe('world_context');
    expect((result[0].content_blocks[0] as { kind: string; text?: string }).text).toBe('World prefix text');
  });

  it('maps slot IDs to correct section_type', () => {
    const context = buildContext();
    const registry: Record<string, PromptSlotConfig> = {
      system_core: buildSlot({ id: 'system_core', default_template: 'sys' }),
      system_policy: buildSlot({ id: 'system_policy', default_template: 'pol' }),
      role_core: buildSlot({ id: 'role_core', default_template: 'role' }),
      world_context: buildSlot({ id: 'world_context', template_context: 'world_prompts' }),
      output_contract: buildSlot({ id: 'output_contract', default_template: 'oc' })
    };

    const { result } = runTemplateTrack(registry, resolveSlotPositions(registry).resolved_positions, context);

    const types = result.map(d => `${d.slot}:${d.section_type}`);
    expect(types).toContain('system_core:system_instruction');
    expect(types).toContain('system_policy:system_policy');
    expect(types).toContain('role_core:role_context');
    expect(types).toContain('world_context:world_context');
    expect(types).toContain('output_contract:output_contract');
  });

  it('generates dynamic output_contract when no default_template', () => {
    const slot = buildSlot({ id: 'output_contract', default_priority: 90 });
    const context = buildContext();
    const registry: Record<string, PromptSlotConfig> = { output_contract: slot };

    const { result } = runTemplateTrack(registry, resolveSlotPositions(registry).resolved_positions, context);

    expect(result).toHaveLength(1);
    expect(result[0].slot).toBe('output_contract');
    expect(result[0].section_type).toBe('output_contract');
    expect((result[0].content_blocks[0] as { kind: string; text?: string }).text?.length).toBeGreaterThan(0);
  });

  it('records correct TrackTrace', () => {
    const registry: Record<string, PromptSlotConfig> = {
      system_core: buildSlot({ id: 'system_core', default_template: 'hello' }),
      memory_short_term: buildSlot({ id: 'memory_short_term' }),
      disabled_slot: buildSlot({ id: 'disabled_slot', default_template: 'nope', enabled: false })
    };
    const context = buildContext();

    const { trace } = runTemplateTrack(registry, resolveSlotPositions(registry).resolved_positions, context);

    expect(trace.track).toBe('template');
    expect(trace.input_summary.slot_count).toBe(3);
    expect(trace.input_summary.templated_slots).toBe(1);
    expect(trace.output_summary.section_drafts_count).toBe(1);
    expect(trace.decisions).toEqual([]);
  });
});
