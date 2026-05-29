import { describe, expect, it } from 'vitest';

import { registerIdentity } from '../../../src/app/services/identity/identity.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

describe('registerIdentity', () => {
  it('creates an identity with required fields', async () => {
    const ctx = createMockAppContext();
    ctx.prisma.identity.create.mockResolvedValue({
      id: 'id-1',
      type: 'human',
      name: 'Alice',
      provider: 'm2',
      status: 'active',
      claims: null,
      metadata: null,
      pack_id: null,
      created_at: 0n,
      updated_at: 0n
    });

    const result = await registerIdentity(ctx, { id: 'id-1', type: 'human', name: 'Alice' });

    expect(result.id).toBe('id-1');
    expect(result.type).toBe('human');
    expect(ctx.prisma.identity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'id-1',
          type: 'human',
          name: 'Alice',
          provider: 'm2',
          status: 'active'
        })
      })
    );
  });

  it('throws when id is missing', async () => {
    const ctx = createMockAppContext();

    await expect(
      registerIdentity(ctx, { id: '', type: 'human' })
    ).rejects.toMatchObject({ status: 400, code: 'IDENTITY_INVALID' });
  });

  it('throws when type is missing', async () => {
    const ctx = createMockAppContext();

    await expect(
      registerIdentity(ctx, { id: 'id-1', type: '' })
    ).rejects.toMatchObject({ status: 400, code: 'IDENTITY_INVALID' });
  });

  it('stores optional fields when provided', async () => {
    const ctx = createMockAppContext();
    const created = {
      id: 'id-2',
      type: 'ai',
      name: 'Bot',
      provider: 'm2',
      status: 'active',
      claims: { verified: true },
      metadata: { source: 'import' },
      pack_id: 'pack-1',
      created_at: 0n,
      updated_at: 0n
    };
    ctx.prisma.identity.create.mockResolvedValue(created);

    const result = await registerIdentity(ctx, {
      id: 'id-2',
      type: 'ai',
      name: 'Bot',
      claims: { verified: true },
      metadata: { source: 'import' },
      packId: 'pack-1'
    });

    expect(result).toEqual(created);
    expect(ctx.prisma.identity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          claims: { verified: true },
          metadata: { source: 'import' },
          pack_id: 'pack-1'
        })
      })
    );
  });

  it('uses packRuntime tick for created_at when packRuntime is provided', async () => {
    const ctx = createMockAppContext();
    ctx.prisma.identity.create.mockResolvedValue({ id: 'id-3' });

    await registerIdentity(
      ctx,
      { id: 'id-3', type: 'human' },
      { getCurrentTick: () => 999n } as never
    );

    expect(ctx.prisma.identity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ created_at: 999n, updated_at: 999n })
      })
    );
  });
});
