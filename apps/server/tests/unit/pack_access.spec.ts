import type { PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppContext } from '../../src/app/context.js'
import { checkPackAccess } from '../../src/operator/guard/pack_access.js'
import { wrapPrismaAsRepositories } from '../helpers/mock_repos.js'

describe('pack access guard', () => {
  let context: AppContext
  let mockFindPackBinding: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFindPackBinding = vi.fn()
    const sim = {
      getCurrentTick: () => 1000n
    } as AppContext['sim']
    const prisma = {} as unknown as AppContext['prisma'];
    const repos = wrapPrismaAsRepositories(prisma as PrismaClient);
    repos.identityOperator = {
      getPrisma: () => prisma as PrismaClient,
      findPackBinding: mockFindPackBinding
    } as unknown as typeof repos.identityOperator;

    context = {
      prisma,
      repos,
      sim,
      clock: sim as AppContext['clock'],
      activePack: sim as AppContext['activePack']
    } as AppContext
  })

  it('allows access when binding exists', async () => {
    mockFindPackBinding.mockResolvedValue({
      binding_type: 'member'
    })

    const result = await checkPackAccess(context, 'op-1', 'pack-1')

    expect(result.allowed).toBe(true)
    expect(result.bindingType).toBe('member')
  })

  it('denies access when no binding exists (including root)', async () => {
    mockFindPackBinding.mockResolvedValue(null)

    const result = await checkPackAccess(context, 'op-root', 'pack-1')

    expect(result.allowed).toBe(false)
    expect(result.bindingType).toBeNull()
    expect(result.reason).toBe('NOT_BOUND')
  })

  it('returns correct bindingType for owner role', async () => {
    mockFindPackBinding.mockResolvedValue({
      binding_type: 'owner'
    })

    const result = await checkPackAccess(context, 'op-1', 'pack-1')

    expect(result.allowed).toBe(true)
    expect(result.bindingType).toBe('owner')
  })

  it('returns correct bindingType for spectator role', async () => {
    mockFindPackBinding.mockResolvedValue({
      binding_type: 'spectator'
    })

    const result = await checkPackAccess(context, 'op-2', 'pack-1')

    expect(result.allowed).toBe(true)
    expect(result.bindingType).toBe('spectator')
  })

  it('denies access for different pack', async () => {
    mockFindPackBinding.mockResolvedValue(null)

    const result = await checkPackAccess(context, 'op-1', 'pack-2')

    expect(result.allowed).toBe(false)
  })
})
