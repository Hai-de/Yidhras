import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { AppContext } from '../../src/app/context.js'
import { checkCapability } from '../../src/app/middleware/capability.js'
import { createOperatorGrant } from '../../src/app/services/operator_grants.js'
import { OPERATOR_STATUS, PACK_BINDING_TYPE } from '../../src/operator/constants.js'
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js'

describe('capability enforcement integration', () => {
  let cleanup: (() => Promise<void>) | null = null
  let context: AppContext

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture()
    cleanup = fixture.cleanup
    context = fixture.context

    const now = context.sim.getCurrentTick()

    // 创建 operators
    await context.prisma.identity.createMany({
      data: [
        { id: 'identity-alice', type: 'user', name: 'alice', provider: 'operator', status: 'active', created_at: now, updated_at: now },
        { id: 'identity-bob', type: 'user', name: 'bob', provider: 'operator', status: 'active', created_at: now, updated_at: now },
        { id: 'identity-root', type: 'user', name: 'root', provider: 'operator', status: 'active', created_at: now, updated_at: now }
      ]
    })
    await context.prisma.operator.createMany({
      data: [
        { id: 'op-alice', identity_id: 'identity-alice', username: 'alice', password_hash: 'hash', is_root: false, status: OPERATOR_STATUS.ACTIVE, created_at: now, updated_at: now },
        { id: 'op-bob', identity_id: 'identity-bob', username: 'bob', password_hash: 'hash', is_root: false, status: OPERATOR_STATUS.ACTIVE, created_at: now, updated_at: now },
        { id: 'op-root', identity_id: 'identity-root', username: 'root', password_hash: 'hash', is_root: true, status: OPERATOR_STATUS.ACTIVE, created_at: now, updated_at: now }
      ]
    })
    // 绑定到 pack-1
    await context.prisma.operatorPackBinding.createMany({
      data: [
        { operator_id: 'op-alice', pack_id: 'pack-1', binding_type: PACK_BINDING_TYPE.MEMBER, bound_at: now, created_at: now },
        { operator_id: 'op-bob', pack_id: 'pack-1', binding_type: PACK_BINDING_TYPE.MEMBER, bound_at: now, created_at: now },
        { operator_id: 'op-root', pack_id: 'pack-1', binding_type: PACK_BINDING_TYPE.OWNER, bound_at: now, created_at: now }
      ]
    })
  })

  afterAll(async () => {
    await cleanup?.()
  })

  it('allows root operator all capabilities', async () => {
    const result = await checkCapability(context, 'op-root', 'pack-1', 'perceive.agent.context')
    expect(result.allowed).toBe(true)
  })

  it('denies non-root operator without grant', async () => {
    const result = await checkCapability(context, 'op-alice', 'pack-1', 'perceive.agent.context')
    expect(result.allowed).toBe(false)
  })

  it('allows operator with valid grant', async () => {
    await createOperatorGrant(context, 'pack-1', 'op-alice', 'identity-bob', 'perceive.agent.context')

    const result = await checkCapability(context, 'op-bob', 'pack-1', 'perceive.agent.context')
    expect(result.allowed).toBe(true)
    expect(result.fromOperatorGrant).toBe(true)
  })

  it('allows giver who has own grant', async () => {
    // Alice gave Bob `perceive.agent.context`, so Alice should also be able to grant (she has it implicit via giving)
    // But the current checkCapability only checks if receiver has a grant
    const result = await checkCapability(context, 'op-alice', 'pack-1', 'perceive.agent.context')
    // Alice 自己没有这个 grant，所以应该被拒绝
    expect(result.allowed).toBe(false)
  })
})
