import { describe, expect, it, vi } from 'vitest';

import { checkCapability } from '../../../src/app/middleware/capability.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

describe('checkCapability', () => {
  it('returns allowed=true for root operator', async () => {
    const ctx = createMockAppContext();
    ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue({
      id: 'op-root',
      identity_id: 'id-root',
      username: 'root',
      is_root: true,
      status: 'active',
      display_name: 'Root',
      created_at: 0n,
      updated_at: 0n
    } as Record<string, unknown>);

    const result = await checkCapability(ctx, 'op-root', 'pack-1', 'perceive.agent.context');

    expect(result.allowed).toBe(true);
    expect(result.fromOperatorGrant).toBe(false);
    expect(result.subjectEntityId).toBe('id-root');
  });

  it('returns allowed=false when operator not found', async () => {
    const ctx = createMockAppContext();
    ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue(null);

    const result = await checkCapability(ctx, 'nonexistent', 'pack-1', 'perceive.agent.context');

    expect(result.allowed).toBe(false);
    expect(result.subjectEntityId).toBeNull();
  });

  it('returns allowed=true when operator has matching grant', async () => {
    const ctx = createMockAppContext();
    ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue({
      id: 'op-1',
      identity_id: 'id-1',
      username: 'alice',
      is_root: false,
      status: 'active',
      display_name: 'Alice',
      created_at: 0n,
      updated_at: 0n
    } as Record<string, unknown>);
    // Mock findOperatorGrant to return a matching grant
    (ctx.repos.identityOperator.findOperatorGrant as unknown) = vi.fn().mockResolvedValue({
      id: 'grant-1',
      capability_key: 'perceive.agent.context'
    });

    const result = await checkCapability(ctx, 'op-1', 'pack-1', 'perceive.agent.context');

    expect(result.allowed).toBe(true);
    expect(result.fromOperatorGrant).toBe(true);
    expect(result.operatorGrantId).toBe('grant-1');
  });

  it('returns allowed=false when non-root has no matching grant', async () => {
    const ctx = createMockAppContext();
    ctx.prisma.operator.findUnique = vi.fn().mockResolvedValue({
      id: 'op-1',
      identity_id: 'id-1',
      username: 'alice',
      is_root: false,
      status: 'active',
      display_name: 'Alice',
      created_at: 0n,
      updated_at: 0n
    } as Record<string, unknown>);
    (ctx.repos.identityOperator.findOperatorGrant as unknown) = vi.fn().mockResolvedValue(null);

    const result = await checkCapability(ctx, 'op-1', 'pack-1', 'perceive.agent.context');

    expect(result.allowed).toBe(false);
    expect(result.subjectEntityId).toBe('id-1');
  });
});
