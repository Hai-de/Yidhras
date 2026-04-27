import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppContext } from '../../src/app/context.js'
import { checkPackAccess } from '../../src/operator/guard/pack_access.js'

describe('pack access guard', () => {
  let context: AppContext
  let mockFindUnique: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFindUnique = vi.fn()
    const sim = {
      getCurrentTick: () => 1000n
    } as AppContext['sim']
    context = {
      prisma: {
        operatorPackBinding: {
          findUnique: mockFindUnique
        }
      } as unknown as AppContext['prisma'],
      sim,
      clock: sim as AppContext['clock'],
      activePack: sim as AppContext['activePack']
    } as AppContext
  })

  it('allows access when binding exists', async () => {
    mockFindUnique.mockResolvedValue({
      operator_id: 'op-1',
      pack_id: 'pack-1',
      binding_type: 'member'
    })

    const result = await checkPackAccess(context, 'op-1', 'pack-1')

    expect(result.allowed).toBe(true)
    expect(result.bindingType).toBe('member')
  })

  it('denies access when no binding exists (including root)', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await checkPackAccess(context, 'op-root', 'pack-1')

    expect(result.allowed).toBe(false)
    expect(result.bindingType).toBeNull()
    expect(result.reason).toBe('NOT_BOUND')
  })

  it('returns correct bindingType for owner role', async () => {
    mockFindUnique.mockResolvedValue({
      operator_id: 'op-1',
      pack_id: 'pack-1',
      binding_type: 'owner'
    })

    const result = await checkPackAccess(context, 'op-1', 'pack-1')

    expect(result.allowed).toBe(true)
    expect(result.bindingType).toBe('owner')
  })

  it('returns correct bindingType for spectator role', async () => {
    mockFindUnique.mockResolvedValue({
      operator_id: 'op-2',
      pack_id: 'pack-1',
      binding_type: 'spectator'
    })

    const result = await checkPackAccess(context, 'op-2', 'pack-1')

    expect(result.allowed).toBe(true)
    expect(result.bindingType).toBe('spectator')
  })

  it('denies access for different pack', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await checkPackAccess(context, 'op-1', 'pack-2')

    expect(result.allowed).toBe(false)
  })
})
