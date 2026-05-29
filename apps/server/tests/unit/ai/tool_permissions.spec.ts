import { describe, expect, it } from 'vitest';

import { checkToolPermission, resolveToolPermissions } from '../../../src/ai/tool_permissions.js';

describe('checkToolPermission', () => {
  it('allows matching tool with matching role', () => {
    const result = checkToolPermission(
      { tool_id: 'search', allowed_roles: ['admin', 'viewer'] },
      { tool_id: 'search', agent_role: 'admin' }
    );
    expect(result.allowed).toBe(true);
  });

  it('rejects when allowed_roles is empty and agent_role provided', () => {
    const result = checkToolPermission(
      { tool_id: 'search', allowed_roles: [] },
      { tool_id: 'search', agent_role: 'anyone' }
    );
    expect(result.allowed).toBe(false);
  });

  it('allows when allowed_roles is empty and no agent_role', () => {
    const result = checkToolPermission(
      { tool_id: 'search', allowed_roles: [] },
      { tool_id: 'search' }
    );
    expect(result.allowed).toBe(true);
  });

  it('rejects non-matching tool_id', () => {
    const result = checkToolPermission(
      { tool_id: 'search', allowed_roles: ['admin'] },
      { tool_id: 'delete', agent_role: 'admin' }
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('does not match');
  });

  it('rejects non-matching role', () => {
    const result = checkToolPermission(
      { tool_id: 'search', allowed_roles: ['admin'] },
      { tool_id: 'search', agent_role: 'viewer' }
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not in allowed roles');
  });

  it('allows when agent_role is null', () => {
    const result = checkToolPermission(
      { tool_id: 'search', allowed_roles: ['admin'] },
      { tool_id: 'search', agent_role: null }
    );
    expect(result.allowed).toBe(true);
  });

  it('allows when agent_role is undefined', () => {
    const result = checkToolPermission(
      { tool_id: 'search', allowed_roles: ['admin'] },
      { tool_id: 'search' }
    );
    expect(result.allowed).toBe(true);
  });

  it('rejects pack not in allowed list', () => {
    const result = checkToolPermission(
      { tool_id: 'search', allowed_roles: [], allowed_pack_ids: ['pack-1', 'pack-2'] },
      { tool_id: 'search', pack_id: 'pack-3' }
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not in allowed pack IDs');
  });

  it('allows pack in allowed list', () => {
    const result = checkToolPermission(
      { tool_id: 'search', allowed_roles: [], allowed_pack_ids: ['pack-1', 'pack-2'] },
      { tool_id: 'search', pack_id: 'pack-1' }
    );
    expect(result.allowed).toBe(true);
  });

  it('rejects when pack_id is null but allowed_pack_ids specified', () => {
    const result = checkToolPermission(
      { tool_id: 'search', allowed_roles: [], allowed_pack_ids: ['pack-1'] },
      { tool_id: 'search', pack_id: null }
    );
    expect(result.allowed).toBe(false);
  });

  it('allows when no allowed_pack_ids specified', () => {
    const result = checkToolPermission(
      { tool_id: 'search', allowed_roles: [] },
      { tool_id: 'search', pack_id: 'any-pack' }
    );
    expect(result.allowed).toBe(true);
  });

  it('rejects missing required capability', () => {
    const result = checkToolPermission(
      { tool_id: 'search', allowed_roles: [], require_capability: 'write' },
      { tool_id: 'search', capabilities: ['read'] }
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Required capability');
  });

  it('allows when required capability present', () => {
    const result = checkToolPermission(
      { tool_id: 'search', allowed_roles: [], require_capability: 'write' },
      { tool_id: 'search', capabilities: ['read', 'write'] }
    );
    expect(result.allowed).toBe(true);
  });

  it('rejects when capabilities is undefined but required', () => {
    const result = checkToolPermission(
      { tool_id: 'search', allowed_roles: [], require_capability: 'write' },
      { tool_id: 'search' }
    );
    expect(result.allowed).toBe(false);
  });
});

describe('resolveToolPermissions', () => {
  const policies = [
    { tool_id: 'search', allowed_roles: ['admin'] },
    { tool_id: 'write', allowed_roles: ['admin'], require_capability: 'write' },
    { tool_id: 'read', allowed_roles: [] }
  ];

  it('allows tool without policy (no policy found)', () => {
    const result = resolveToolPermissions(policies, 'unknown_tool', {});
    expect(result.allowed).toBe(true);
  });

  it('delegates to checkToolPermission for matching policy', () => {
    const result = resolveToolPermissions(policies, 'search', { agent_role: 'admin' });
    expect(result.allowed).toBe(true);
  });

  it('rejects when policy check fails', () => {
    const result = resolveToolPermissions(policies, 'search', { agent_role: 'viewer' });
    expect(result.allowed).toBe(false);
  });

  it('rejects when capability missing', () => {
    const result = resolveToolPermissions(policies, 'write', { agent_role: 'admin', capabilities: [] });
    expect(result.allowed).toBe(false);
  });

  it('allows when capability present', () => {
    const result = resolveToolPermissions(policies, 'write', { agent_role: 'admin', capabilities: ['write'] });
    expect(result.allowed).toBe(true);
  });
});
