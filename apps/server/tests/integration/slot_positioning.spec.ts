import { describe, expect, it } from 'vitest';

import { buildPromptBundleV2, buildPromptTree } from '../../src/inference/prompt_builder_v2.js';
import type { PromptSlotConfig } from '../../src/inference/prompt_slot_config.js';
import { resolveSlotPositions } from '../../src/inference/slot_position_resolver.js';
import type { InferenceContext, PromptResolvableContext } from '../../src/inference/types.js';
import { expectDefined } from '../helpers/assertions.js';

type PromptContext = InferenceContext | PromptResolvableContext;

const resolvedSlot = (positions: ReturnType<typeof resolveSlotPositions>['resolved_positions'], slotId: string) =>
  expectDefined(positions.find((p) => p.slot_id === slotId), `resolved slot ${slotId}`);

const createMinimalContext = (): PromptContext =>
  ({
    actor_ref: {
      identity_id: 'test-agent',
      identity_type: 'agent',
      role: 'active',
      agent_id: 'agent-001',
      atmosphere_node_id: null
    },
    actor_display_name: 'Test Agent',
    identity: {
      id: 'test-agent',
      type: 'agent',
      name: 'Test Agent',
      provider: null,
      status: null,
      claims: null
    },
    binding_ref: null,
    resolved_agent_id: 'agent-001',
    agent_snapshot: null,
    tick: 1n,
    strategy: 'mock' as const,
    attributes: {},
    world_pack: { id: 'test-pack', name: 'Test Pack', version: '1.0.0' },
    world_prompts: { global_prefix: 'World context text.' },
    variable_context: { layers: [], alias_precedence: [], strict_namespace: false },
    variable_context_summary: {
      namespaces: [],
      alias_precedence: [],
      strict_namespace: false,
      layer_count: 0
    },
    context_run: null,
    memory_context: null,
    pack_state: {
      actor_roles: [],
      actor_state: null,
      owned_artifacts: [],
      world_state: null,
      latest_event: null
    },
    pack_runtime: { invocation_rules: [] }
  }) as unknown as PromptContext;

const BASE_SLOTS: Record<string, PromptSlotConfig> = {
  system_core: {
    id: 'system_core',
    display_name: 'System Core',
    position: 100,
    default_priority: 100,
    default_template: 'You are a test system.',
    message_role: 'system',
    include_in_combined: true,
    combined_heading: 'System Core',
    enabled: true
  },
  role_core: {
    id: 'role_core',
    display_name: 'Role Core',
    position: 80,
    default_priority: 90,
    default_template: 'You are a test role.',
    message_role: 'developer',
    include_in_combined: true,
    combined_heading: 'Role Core',
    enabled: true
  },
  world_context: {
    id: 'world_context',
    display_name: 'World Context',
    position: 70,
    default_priority: 80,
    template_context: 'world_prompts',
    message_role: 'system',
    include_in_combined: true,
    combined_heading: 'World Context',
    enabled: true
  },
  memory_summary: {
    id: 'memory_summary',
    display_name: 'Memory Summary',
    position: 60,
    default_priority: 70,
    default_template: 'Memory summary content.',
    message_role: 'user',
    include_in_combined: true,
    combined_heading: 'Memory Summary',
    enabled: true
  }
};

describe('Slot Positioning Integration', () => {
  it('T1: disabled slot retains position — custom_slot anchored after disabled system_policy', () => {
    const registry: Record<string, PromptSlotConfig> = {
      ...BASE_SLOTS,
      system_policy: {
        id: 'system_policy',
        display_name: 'System Policy',
        position: 90,
        default_priority: 95,
        default_template: 'Policy text.',
        message_role: 'system',
        include_in_combined: true,
        combined_heading: 'System Policy',
        enabled: false
      },
      custom_slot: {
        id: 'custom_slot',
        display_name: 'Custom Slot',
        default_priority: 50,
        default_template: 'Custom injected content.',
        anchor: { ref: 'system_policy', relation: 'after' },
        message_role: 'user',
        include_in_combined: true,
        combined_heading: 'Custom',
        enabled: true
      }
    };

    const { resolved_positions, diagnostics } = resolveSlotPositions(registry);

    // system_policy at position 90, custom_slot anchored after it → between 90 and 80
    const sp = resolvedSlot(resolved_positions, 'system_policy');
    const cs = resolvedSlot(resolved_positions, 'custom_slot');
    const rc = resolvedSlot(resolved_positions, 'role_core');

    expect(sp.enabled).toBe(false);
    expect(cs.enabled).toBe(true);
    // custom_slot resolved_position should be between system_policy (90) and role_core (80)
    expect(cs.resolved_position).toBeLessThan(sp.resolved_position);
    expect(cs.resolved_position).toBeGreaterThan(rc.resolved_position);
    // system_core (100) > system_policy (90) > custom_slot (~85) > role_core (80)
    const sortedIds = resolved_positions.map((p) => p.slot_id);
    const spIdx = sortedIds.indexOf('system_policy');
    const csIdx = sortedIds.indexOf('custom_slot');
    const rcIdx = sortedIds.indexOf('role_core');
    expect(spIdx).toBeLessThan(csIdx);
    expect(csIdx).toBeLessThan(rcIdx);
    expect(sortedIds.indexOf('system_core')).toBeLessThan(spIdx);

    // Now verify end-to-end: buildPromptTree → buildPromptBundleV2
    const ctx = createMinimalContext();
    const tree = buildPromptTree(ctx, registry);
    const bundle = buildPromptBundleV2(tree, ctx);

    // system_policy is disabled → no rendered content in bundle
    expect(bundle.slots['system_policy']).toBeUndefined();
    // But it exists in tree.fragments_by_slot as empty array
    expect(tree.fragments_by_slot).toHaveProperty('system_policy');
    expect(tree.fragments_by_slot['system_policy']).toEqual([]);
    // custom_slot content appears
    expect(expectDefined(bundle.slots['custom_slot'], 'custom slot content')).toContain('Custom injected content');
    // custom_slot appears in slot_order
    expect(bundle.slot_order).toContain('custom_slot');
    expect(bundle.slot_order).not.toContain('system_policy');

    // No diagnostics warnings expected
    expect(diagnostics.warnings).toHaveLength(0);
  });

  it('T2: dynamic slot with anchor:after positioning — content appears between ref and next slot', () => {
    const registry: Record<string, PromptSlotConfig> = {
      ...BASE_SLOTS,
      custom_slot: {
        id: 'custom_slot',
        display_name: 'Custom',
        default_priority: 50,
        default_template: 'Dynamic custom content.',
        anchor: { ref: 'world_context', relation: 'after' },
        message_role: 'user',
        include_in_combined: true,
        combined_heading: 'Custom Slot',
        enabled: true
      }
    };

    const { resolved_positions } = resolveSlotPositions(registry);

    // world_context at position 70, memory_summary at 60
    // custom_slot anchored after world_context → between 70 and 60 (= 65)
    const wc = resolvedSlot(resolved_positions, 'world_context');
    const ms = resolvedSlot(resolved_positions, 'memory_summary');
    const cs = resolvedSlot(resolved_positions, 'custom_slot');

    expect(cs.resolved_position).toBeLessThan(wc.resolved_position);
    expect(cs.resolved_position).toBeGreaterThan(ms.resolved_position);

    const ctx = createMinimalContext();
    const tree = buildPromptTree(ctx, registry);
    const bundle = buildPromptBundleV2(tree, ctx);

    // Verify slot_order: world_context comes before custom_slot before memory_summary
    const wcIdx = bundle.slot_order.indexOf('world_context');
    const csIdx = bundle.slot_order.indexOf('custom_slot');
    const msIdx = bundle.slot_order.indexOf('memory_summary');
    expect(wcIdx).toBeLessThan(csIdx);
    expect(csIdx).toBeLessThan(msIdx);

    // Verify combined_prompt text ordering
    const combined = bundle.combined_prompt;
    const wcPos = combined.indexOf('World Context');
    const csPos = combined.indexOf('Custom Slot');
    const msPos = combined.indexOf('Memory Summary');
    expect(wcPos).toBeLessThan(csPos);
    expect(csPos).toBeLessThan(msPos);
    expect(expectDefined(bundle.slots['custom_slot'], 'custom slot content')).toContain('Dynamic custom content');
  });

  it('T3: YAML position ordering — resolved_positions in descending order', () => {
    // Simulates the default YAML config with explicit position fields
    const registry: Record<string, PromptSlotConfig> = {
      system_core: {
        id: 'system_core',
        display_name: 'System Core',
        position: 100,
        default_priority: 100,
        default_template: 'System.',
        message_role: 'system',
        include_in_combined: true,
        combined_heading: 'SC',
        enabled: true
      },
      system_policy: {
        id: 'system_policy',
        display_name: 'System Policy',
        position: 90,
        default_priority: 95,
        message_role: 'system',
        include_in_combined: true,
        combined_heading: 'SP',
        enabled: true
      },
      role_core: {
        id: 'role_core',
        display_name: 'Role Core',
        position: 80,
        default_priority: 90,
        default_template: 'Role.',
        message_role: 'developer',
        include_in_combined: true,
        combined_heading: 'RC',
        enabled: true
      },
      world_context: {
        id: 'world_context',
        display_name: 'World Context',
        position: 70,
        default_priority: 80,
        template_context: 'world_prompts',
        message_role: 'system',
        include_in_combined: true,
        combined_heading: 'WC',
        enabled: true
      },
      memory_summary: {
        id: 'memory_summary',
        display_name: 'Memory Summary',
        position: 60,
        default_priority: 70,
        message_role: 'user',
        include_in_combined: true,
        combined_heading: 'MS',
        enabled: true
      },
      post_process: {
        id: 'post_process',
        display_name: 'Post Process',
        position: 50,
        default_priority: 60,
        message_role: 'user',
        include_in_combined: true,
        combined_heading: 'PP',
        enabled: true
      },
      output_contract: {
        id: 'output_contract',
        display_name: 'Output Contract',
        position: 40,
        default_priority: 50,
        default_template: 'Return JSON.',
        message_role: 'user',
        include_in_combined: true,
        combined_heading: 'OC',
        enabled: true
      },
      conversation_history: {
        id: 'conversation_history',
        display_name: 'Conversation History',
        position: 30,
        default_priority: 50,
        message_role: 'user',
        include_in_combined: true,
        combined_heading: 'CH',
        enabled: true
      }
    };

    const { resolved_positions, diagnostics } = resolveSlotPositions(registry);

    // All should be explicit resolution
    for (const r of resolved_positions) {
      expect(r.resolution_source).toBe('explicit');
    }

    // Verify descending order
    for (let i = 1; i < resolved_positions.length; i++) {
      expect(resolved_positions[i - 1].resolved_position).toBeGreaterThan(
        resolved_positions[i].resolved_position
      );
    }

    // Verify expected order (by position: 100, 90, 80, 70, 60, 50, 40, 30)
    const expectedOrder = [
      'system_core',
      'system_policy',
      'role_core',
      'world_context',
      'memory_summary',
      'post_process',
      'output_contract',
      'conversation_history'
    ];
    expect(resolved_positions.map((p) => p.slot_id)).toEqual(expectedOrder);

    // No warnings
    expect(diagnostics.warnings).toHaveLength(0);

    // End-to-end: buildPromptTree → buildPromptBundleV2
    const ctx = createMinimalContext();
    const tree = buildPromptTree(ctx, registry);
    const bundle = buildPromptBundleV2(tree, ctx);

    // slot_order should follow the same descending position order
    // (only slots that actually produce content)
    for (let i = 1; i < bundle.slot_order.length; i++) {
      const prevSlot = bundle.slot_order[i - 1];
      const currSlot = bundle.slot_order[i];
      const prevPos =
        resolved_positions.find((p) => p.slot_id === prevSlot)?.resolved_position ?? 0;
      const currPos =
        resolved_positions.find((p) => p.slot_id === currSlot)?.resolved_position ?? 0;
      expect(prevPos).toBeGreaterThan(currPos);
    }
  });
});
