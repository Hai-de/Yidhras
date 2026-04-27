import { describe, expect, it } from 'vitest';

import type { ToolPermissionPolicy } from '../../src/ai/tool_permissions.js';
import { checkToolPermission, resolveToolPermissions } from '../../src/ai/tool_permissions.js';

describe('checkToolPermission', () => {
  const basePolicy: ToolPermissionPolicy = {
    tool_id: 'sys.get_entity',
    allowed_roles: ['active', 'atmosphere']
  };

  it('allows when agent_role is in allowed_roles', () => {
    const result = checkToolPermission(basePolicy, {
      tool_id: 'sys.get_entity',
      agent_role: 'active'
    });
    expect(result.allowed).toBe(true);
  });

  it('denies when agent_role is not in allowed_roles', () => {
    const result = checkToolPermission(basePolicy, {
      tool_id: 'sys.get_entity',
      agent_role: 'observer'
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('observer');
  });

  it('allows when no agent_role is provided (unauthenticated)', () => {
    const result = checkToolPermission(basePolicy, {
      tool_id: 'sys.get_entity'
    });
    expect(result.allowed).toBe(true);
  });

  it('denies when tool_id does not match', () => {
    const result = checkToolPermission(basePolicy, {
      tool_id: 'sys.other_tool',
      agent_role: 'active'
    });
    expect(result.allowed).toBe(false);
  });

  it('enforces pack_id whitelist', () => {
    const policy: ToolPermissionPolicy = {
      tool_id: 'sys.get_entity',
      allowed_roles: ['active'],
      allowed_pack_ids: ['pack-a', 'pack-b']
    };

    expect(checkToolPermission(policy, { tool_id: 'sys.get_entity', agent_role: 'active', pack_id: 'pack-a' }).allowed).toBe(true);
    expect(checkToolPermission(policy, { tool_id: 'sys.get_entity', agent_role: 'active', pack_id: 'pack-c' }).allowed).toBe(false);
    expect(checkToolPermission(policy, { tool_id: 'sys.get_entity', agent_role: 'active' }).allowed).toBe(false);
  });

  it('enforces required capability', () => {
    const policy: ToolPermissionPolicy = {
      tool_id: 'sys.query_memory_blocks',
      allowed_roles: ['active'],
      require_capability: 'invoke.memory_query'
    };

    expect(checkToolPermission(policy, {
      tool_id: 'sys.query_memory_blocks',
      agent_role: 'active',
      capabilities: ['invoke.memory_query', 'read.entity']
    }).allowed).toBe(true);

    expect(checkToolPermission(policy, {
      tool_id: 'sys.query_memory_blocks',
      agent_role: 'active',
      capabilities: ['read.entity']
    }).allowed).toBe(false);
  });
});

describe('resolveToolPermissions', () => {
  const policies: ToolPermissionPolicy[] = [
    { tool_id: 'sys.get_entity', allowed_roles: ['active'] },
    { tool_id: 'sys.query_memory_blocks', allowed_roles: ['active', 'atmosphere'], require_capability: 'invoke.memory_query' }
  ];

  it('allows when no policy exists for the tool', () => {
    const result = resolveToolPermissions(policies, 'sys.get_clock_state', {
      agent_role: 'observer'
    });
    expect(result.allowed).toBe(true);
  });

  it('denies when policy exists and role does not match', () => {
    const result = resolveToolPermissions(policies, 'sys.get_entity', {
      agent_role: 'observer'
    });
    expect(result.allowed).toBe(false);
  });

  it('allows when policy exists and all checks pass', () => {
    const result = resolveToolPermissions(policies, 'sys.query_memory_blocks', {
      agent_role: 'active',
      capabilities: ['invoke.memory_query']
    });
    expect(result.allowed).toBe(true);
  });
});
