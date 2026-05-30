import { describe, expect, it, vi } from 'vitest';

import { resolveActor } from '../../../../src/inference/context/actor_resolver.js';
import { expectDefined } from '../../../helpers/assertions.js';

interface RepoAgent {
  findAgentById: ReturnType<typeof vi.fn>;
  findAgentByIdWithCircles: ReturnType<typeof vi.fn>;
}

interface RepoIdentityOp {
  findIdentityById: ReturnType<typeof vi.fn>;
  listIdentityBindings: ReturnType<typeof vi.fn>;
  findActiveBindingForAgent: ReturnType<typeof vi.fn>;
}

function makeCtx(overrides?: {
  repos?: {
    agent?: Partial<RepoAgent>;
    identityOperator?: Partial<RepoIdentityOp>;
  };
  getPackRuntimeHost?: ReturnType<typeof vi.fn>;
}) {
  return {
    repos: {
      agent: {
        findAgentById: vi.fn(async () => null),
        findAgentByIdWithCircles: vi.fn(async () => null),
        ...overrides?.repos?.agent
      },
      identityOperator: {
        findIdentityById: vi.fn(async () => null),
        listIdentityBindings: vi.fn(async () => []),
        findActiveBindingForAgent: vi.fn(async () => null),
        ...overrides?.repos?.identityOperator
      }
    },
    getPackRuntimeHost: overrides?.getPackRuntimeHost ?? vi.fn(() => null)
  };
}

describe('resolveActor', () => {
  // ── Agent ID strategy ────────────────────────────────────

  describe('agent_id path', () => {
    it('resolves actor when agent exists', async () => {
      const ctx = makeCtx({
        repos: {
          agent: {
            findAgentByIdWithCircles: vi.fn(async () => ({
              id: 'agent-1', name: 'Alice', type: 'agent', snr: 0.8, is_pinned: true
            }))
          }
        }
      });

      const result = await resolveActor(ctx, { agent_id: 'agent-1' });

      expect(result.resolved_agent_id).toBe('agent-1');
      expect(result.actor_display_name).toBe('Alice');
      expect(result.actor_ref.agent_id).toBe('agent-1');
      expect(result.actor_ref.role).toBe('active');
      expect(result.binding_ref).toBeNull();
      expect(result.agent_snapshot).toEqual({
        id: 'agent-1', name: 'Alice', type: 'agent', snr: 0.8, is_pinned: true
      });
    });

    it('throws AGENT_NOT_FOUND when agent does not exist', async () => {
      const ctx = makeCtx();
      await expect(resolveActor(ctx, { agent_id: 'nonexistent' }))
        .rejects.toThrow('Agent not found');
    });
  });

  // ── Identity ID strategy ─────────────────────────────────

  describe('identity_id path', () => {
    it('throws IDENTITY_NOT_FOUND when identity does not exist', async () => {
      const ctx = makeCtx();
      await expect(resolveActor(ctx, { identity_id: 'unknown' }))
        .rejects.toThrow('Identity not found');
    });

    it('handles identity with agent binding', async () => {
      const ctx = makeCtx({
        repos: {
          identityOperator: {
            findIdentityById: vi.fn(async () => ({
              id: 'id-1', type: 'agent' as const, name: 'Bob',
              provider: 'local', status: 'active', claims: null
            })),
            listIdentityBindings: vi.fn(async () => [{
              id: 'bind-1', role: 'active', status: 'active',
              agent_id: 'agent-2', atmosphere_node_id: null,
              identity: { id: 'id-1', type: 'agent', name: 'Bob', provider: 'local', status: 'active', claims: null },
              atmosphere_node: null
            }])
          },
          agent: {
            findAgentByIdWithCircles: vi.fn(async () => ({
              id: 'agent-2', name: 'Bob Agent', type: 'agent', snr: 0.5, is_pinned: false
            }))
          }
        }
      });

      const result = await resolveActor(ctx, { identity_id: 'id-1' });

      expect(result.identity.id).toBe('id-1');
      expect(result.resolved_agent_id).toBe('agent-2');
      const bindingRef = expectDefined(result.binding_ref);
      expect(bindingRef.agent_id).toBe('agent-2');
    });

    it('handles atmosphere binding', async () => {
      const ctx = makeCtx({
        repos: {
          identityOperator: {
            findIdentityById: vi.fn(async () => ({
              id: 'id-2', type: 'anonymous' as const, name: 'Atmo',
              provider: null, status: null, claims: null
            })),
            listIdentityBindings: vi.fn(async () => [{
              id: 'bind-2', role: 'atmosphere', status: 'active',
              agent_id: null, atmosphere_node_id: 'atm-1',
              identity: { id: 'id-2', type: 'anonymous', name: 'Atmo', provider: 'local', status: 'active', claims: null },
              atmosphere_node: { id: 'atm-1', name: 'The Void', owner_id: 'owner-1' }
            }])
          }
        }
      });

      const result = await resolveActor(ctx, { identity_id: 'id-2' });

      expect(result.actor_ref.role).toBe('atmosphere');
      expect(result.actor_ref.atmosphere_node_id).toBe('atm-1');
      expect(result.resolved_agent_id).toBeNull();
      expect(result.agent_snapshot).toBeNull();
    });

    it('returns identity-only actor when no bindings exist', async () => {
      const ctx = makeCtx({
        repos: {
          identityOperator: {
            findIdentityById: vi.fn(async () => ({
              id: 'id-3', type: 'user' as const, name: 'Carol',
              provider: 'oidc', status: 'active', claims: { sub: 'carol' }
            })),
            listIdentityBindings: vi.fn(async () => [])
          }
        }
      });

      const result = await resolveActor(ctx, { identity_id: 'id-3' });

      expect(result.identity.id).toBe('id-3');
      expect(result.resolved_agent_id).toBeNull();
      expect(result.binding_ref).toBeNull();
    });
  });

  // ── Actor Entity ID strategy ─────────────────────────────

  describe('actor_entity_id path', () => {
    it('throws when packId is missing', async () => {
      const ctx = makeCtx();
      await expect(resolveActor(ctx, { actor_entity_id: 'e1' }))
        .rejects.toThrow('actor_entity_id requires pack_id');
    });

    it('throws when agent not found in pack', async () => {
      const ctx = makeCtx();
      await expect(resolveActor(ctx, { actor_entity_id: 'e1' }, 'pack-1'))
        .rejects.toThrow('Pack actor entity not found');
    });

    it('synthesizes identity when no binding exists', async () => {
      const pack = {
        metadata: { id: 'pack-1', name: 'Pack', version: '1' },
        entities: { actors: [{ id: 'e1', kind: 'actor' }] }
      };
      const ctx = makeCtx({
        repos: {
          agent: {
            findAgentById: vi.fn(async () => ({
              id: 'pack-1:e1', name: 'Entity One', type: 'actor', snr: 0.7, is_pinned: false
            }))
          },
          identityOperator: {
            findActiveBindingForAgent: vi.fn(async () => null)
          }
        },
        getPackRuntimeHost: vi.fn(() => ({ getPack: () => pack }))
      });

      const result = await resolveActor(ctx, { actor_entity_id: 'e1' }, 'pack-1');

      expect(result.resolved_agent_id).toBe('pack-1:e1');
      expect(result.identity.type).toBe('agent');
      expect(result.identity.provider).toBe('pack');
      expect(result.binding_ref).toBeNull();
    });

    it('uses binding identity when binding exists', async () => {
      const ctx = makeCtx({
        repos: {
          agent: {
            findAgentById: vi.fn(async () => ({
              id: 'pack-1:e2', name: 'Bound Entity', type: 'actor', snr: 0.3, is_pinned: true
            }))
          },
          identityOperator: {
            findActiveBindingForAgent: vi.fn(async () => ({
              id: 'bind-3', role: 'active', status: 'active',
              agent_id: 'pack-1:e2', atmosphere_node_id: null,
              identity: { id: 'id-real', type: 'agent', name: 'Real ID', provider: 'local', status: 'active', claims: null }
            }))
          }
        }
      });

      const result = await resolveActor(ctx, { actor_entity_id: 'e2' }, 'pack-1');

      expect(result.identity.id).toBe('id-real');
      expect(result.identity.name).toBe('Real ID');
      expect(result.binding_ref).not.toBeNull();
    });
  });

  // ── System fallback ──────────────────────────────────────

  describe('system fallback', () => {
    it('falls back to system identity when no other input', async () => {
      const ctx = makeCtx({
        repos: {
          identityOperator: {
            findIdentityById: vi.fn(async (id: string) =>
              id === 'system'
                ? { id: 'system', type: 'system' as const, name: 'Yidhras', provider: null, status: null, claims: null }
                : null
            )
          }
        }
      });

      const result = await resolveActor(ctx, {});

      expect(result.identity.id).toBe('system');
      expect(result.actor_ref.identity_id).toBe('system');
      expect(result.actor_display_name).toBe('Yidhras');
    });

    it('throws when system identity is missing', async () => {
      const ctx = makeCtx();
      await expect(resolveActor(ctx, {}))
        .rejects.toThrow('System identity is not configured');
    });
  });

  // ── Strategy precedence ──────────────────────────────────

  describe('strategy precedence', () => {
    it('agent_id takes precedence over identity_id', async () => {
      const ctx = makeCtx({
        repos: {
          agent: {
            findAgentByIdWithCircles: vi.fn(async () => ({
              id: 'agent-direct', name: 'Direct', type: 'agent', snr: 0.9, is_pinned: true
            }))
          }
        }
      });

      const result = await resolveActor(ctx, {
        agent_id: 'agent-direct',
        identity_id: 'should-be-ignored'
      });

      expect(result.resolved_agent_id).toBe('agent-direct');
    });

    it('actor_entity_id is used when agent_id and identity_id are absent', async () => {
      const pack = {
        metadata: { id: 'pack-1', name: 'P', version: '1' }
      };
      const ctx = makeCtx({
        repos: {
          agent: {
            findAgentById: vi.fn(async () => ({
              id: 'pack-1:e3', name: 'Entity', type: 'actor', snr: 0.4, is_pinned: false
            }))
          },
          identityOperator: {
            findActiveBindingForAgent: vi.fn(async () => null)
          }
        },
        getPackRuntimeHost: vi.fn(() => ({ getPack: () => pack }))
      });

      const result = await resolveActor(ctx, { actor_entity_id: 'e3' }, 'pack-1');

      expect(result.resolved_agent_id).toBe('pack-1:e3');
    });
  });
});
