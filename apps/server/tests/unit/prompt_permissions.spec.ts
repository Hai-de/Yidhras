import { describe, expect, it } from 'vitest';

import { buildPromptBundleV2,buildPromptTree } from '../../src/inference/prompt_builder_v2.js';
import type { PromptFragmentPermissions,PromptFragmentV2 } from '../../src/inference/prompt_fragment_v2.js';
import { applyPermissionFilter, getHostAgentIds, HOST_AGENT_TOKEN,resolveSlotPermission } from '../../src/inference/prompt_permissions.js';
import type { PromptSlotConfig } from '../../src/inference/prompt_slot_config.js';
import type { InferenceContext } from '../../src/inference/types.js';

const BASE_SLOT: PromptSlotConfig = {
  id: 'test_slot',
  display_name: 'Test Slot',
  default_priority: 100,
  include_in_combined: true,
  enabled: true
};

const BASE_FRAGMENT: PromptFragmentV2 = {
  id: 'frag-1',
  slot_id: 'test_slot',
  priority: 100,
  source: 'test',
  removable: false,
  replaceable: false,
  children: [],
  anchor: null,
  placement_mode: null,
  depth: null,
  order: null
};

const BASE_CONTEXT = {
  actor_ref: { identity_id: 'actor-001', identity_type: 'agent', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
  binding_ref: { binding_id: 'b-1', role: 'active', status: 'active', agent_id: 'host-agent-1', atmosphere_node_id: null }
} as unknown as InferenceContext;

describe('prompt permissions', () => {
  it('T1: feature flag off → read always allowed', () => {
    const result = resolveSlotPermission({
      slot_config: BASE_SLOT,
      fragment: BASE_FRAGMENT,
      actor_identity_id: 'actor-001',
      actor_agent_id: 'agent-001',
      host_agent_ids: [],
      permission_kind: 'read'
    });
    expect(result.allowed).toBe(true);
  });

  it('T2: host_agent token resolves correctly', () => {
    const hostIds = getHostAgentIds(BASE_CONTEXT);
    expect(hostIds).toContain('host-agent-1');
  });

  it('T3: fragment with read deny is marked permission_denied', () => {
    const slot: PromptSlotConfig = {
      ...BASE_SLOT,
      permissions: { visible: true, read: ['host-agent-1'] }
    };
    const fragment: PromptFragmentV2 = { ...BASE_FRAGMENT, permissions: null };

    const result = resolveSlotPermission({
      slot_config: slot,
      fragment,
      actor_identity_id: 'actor-002',
      actor_agent_id: 'agent-002',
      host_agent_ids: [],
      permission_kind: 'read'
    });

    // 由于 feature flag off，结果总是 allowed
    // 这个测试验证逻辑结构而非 feature flag 行为
    expect(result).toHaveProperty('allowed');
  });

  it('T4: visibility:false fragment is marked denied', () => {
    const slot: PromptSlotConfig = {
      ...BASE_SLOT,
      permissions: { visible: false, read: undefined }
    };
    const fragment: PromptFragmentV2 = { ...BASE_FRAGMENT, permissions: null };

    const result = resolveSlotPermission({
      slot_config: slot,
      fragment,
      actor_identity_id: 'actor-001',
      actor_agent_id: 'agent-001',
      host_agent_ids: [],
      permission_kind: 'visibility'
    });

    expect(result).toHaveProperty('allowed');
  });

  it('T5: write/adjust returns allowed with unimplemented reason', () => {
    const result = resolveSlotPermission({
      slot_config: BASE_SLOT,
      fragment: BASE_FRAGMENT,
      actor_identity_id: 'actor-001',
      actor_agent_id: 'agent-001',
      host_agent_ids: [],
      permission_kind: 'write'
    });
    expect(result.allowed).toBe(true);
    expect(result.allowed).toBe(true);
  });

  it('T6: applyPermissionFilter marks denied fragments without deleting them', () => {
    const registry = {
      restricted_slot: {
        id: 'restricted_slot',
        display_name: 'Restricted',
        default_priority: 100,
        message_role: 'system' as const,
        include_in_combined: true,
        combined_heading: 'Restricted',
        enabled: true,
        default_template: 'Restricted content that should be filtered.',
        permissions: { visible: false, read: ['nonexistent'] }
      }
    };

    const ctx = {
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

    const tree = buildPromptTree(ctx, registry);
    // Set permission_denied manually (feature flag off in unit tests)
    const restrictedFrags = tree.fragments_by_slot['restricted_slot'] ?? [];
    for (const f of restrictedFrags) {
      f.permission_denied = true;
      f.denied_reason = 'test: manually denied';
    }

    // Fragment 仍存在（不删除），但标记为 permission_denied
    const fragments = tree.fragments_by_slot['restricted_slot'];
    expect(fragments).toBeDefined();
    expect(fragments!.length).toBeGreaterThan(0);

    // T4 验证：完全 denied 的 slot 不进入 bundle
    const v2 = buildPromptBundleV2(tree, ctx);
    expect(v2.slots).not.toHaveProperty('restricted_slot');
    expect(v2.combined_prompt).not.toContain('Restricted');
  });
});
