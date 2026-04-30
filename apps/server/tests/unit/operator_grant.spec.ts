import type { PrismaClient } from '@prisma/client'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppContext } from '../../src/app/context.js'
import { checkCapability } from '../../src/app/middleware/capability.js'
import { wrapPrismaAsRepositories } from '../helpers/mock_repos.js'

describe('operator grant capability check', () => {
  let context: AppContext
  let mockOperatorFindUnique: ReturnType<typeof vi.fn>
  let mockGrantFindFirst: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockOperatorFindUnique = vi.fn()
    mockGrantFindFirst = vi.fn()
    const sim = {
      getCurrentTick: () => 1000n
    } as AppContext['sim']
    const prisma = {
      operator: {
        findUnique: mockOperatorFindUnique
      },
      operatorGrant: {
        findFirst: mockGrantFindFirst
      }
    } as unknown as AppContext['prisma']
    context = {
      repos: wrapPrismaAsRepositories(prisma as PrismaClient),
      prisma,
      sim,
      clock: sim as AppContext['clock'],
      activePack: sim as AppContext['activePack']
    } as AppContext
  })

  it('allows root operator regardless of grants', async () => {
    mockOperatorFindUnique.mockResolvedValue({
      id: 'op-root',
      identity_id: 'identity-root',
      is_root: true
    })

    const result = await checkCapability(context, 'op-root', 'pack-1', 'perceive.agent.context')

    expect(result.allowed).toBe(true)
    expect(result.subjectEntityId).toBe('identity-root')
  })

  it('allows non-root operator with valid grant', async () => {
    mockOperatorFindUnique.mockResolvedValue({
      id: 'op-1',
      identity_id: 'identity-op-1',
      is_root: false
    })
    mockGrantFindFirst.mockResolvedValue({
      id: 'grant-1',
      giver_operator_id: 'op-giver',
      receiver_identity_id: 'identity-op-1',
      pack_id: 'pack-1',
      capability_key: 'perceive.agent.context'
    })

    const result = await checkCapability(context, 'op-1', 'pack-1', 'perceive.agent.context')

    expect(result.allowed).toBe(true)
    expect(result.fromOperatorGrant).toBe(true)
    expect(result.operatorGrantId).toBe('grant-1')
  })

  it('denies non-root operator without grant', async () => {
    mockOperatorFindUnique.mockResolvedValue({
      id: 'op-1',
      identity_id: 'identity-op-1',
      is_root: false
    })
    mockGrantFindFirst.mockResolvedValue(null)

    const result = await checkCapability(context, 'op-1', 'pack-1', 'perceive.agent.context')

    expect(result.allowed).toBe(false)
    expect(result.fromOperatorGrant).toBe(false)
  })

  it('denies when grant is expired', async () => {
    mockOperatorFindUnique.mockResolvedValue({
      id: 'op-1',
      identity_id: 'identity-op-1',
      is_root: false
    })
    mockGrantFindFirst.mockResolvedValue(null) // 过期 grant 不会被匹配

    const result = await checkCapability(context, 'op-1', 'pack-1', 'perceive.agent.context')

    expect(result.allowed).toBe(false)
  })

  it('denies when operator not found', async () => {
    mockOperatorFindUnique.mockResolvedValue(null)

    const result = await checkCapability(context, 'op-missing', 'pack-1', 'perceive.agent.context')

    expect(result.allowed).toBe(false)
    expect(result.subjectEntityId).toBeNull()
  })
})
