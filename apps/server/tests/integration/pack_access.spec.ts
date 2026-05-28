import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { OPERATOR_STATUS, PACK_BINDING_TYPE } from '../../src/operator/constants.js'
import { checkPackAccess } from '../../src/operator/guard/pack_access.js'
import { expectDefined } from '../helpers/assertions.js'
import { TestKit } from '../testkit.js'

describe('pack access integration', () => {
  let kit: TestKit
  const currentTick = () => expectDefined(kit.context.packRuntime, 'pack runtime').getCurrentTick()

  beforeAll(async () => {
    kit = await TestKit.create()

    const now = currentTick()

    // 创建 operators
    await kit.prisma.identity.createMany({
      data: [
        { id: 'identity-alice', type: 'user', name: 'alice', provider: 'operator', status: 'active', created_at: now, updated_at: now },
        { id: 'identity-root', type: 'user', name: 'root', provider: 'operator', status: 'active', created_at: now, updated_at: now }
      ]
    })
    await kit.prisma.operator.createMany({
      data: [
        { id: 'op-alice', identity_id: 'identity-alice', username: 'alice', password_hash: 'hash', is_root: false, status: OPERATOR_STATUS.ACTIVE, created_at: now, updated_at: now },
        { id: 'op-root', identity_id: 'identity-root', username: 'root', password_hash: 'hash', is_root: true, status: OPERATOR_STATUS.ACTIVE, created_at: now, updated_at: now }
      ]
    })

    // Alice 绑定到 pack-1
    await kit.prisma.operatorPackBinding.create({
      data: {
        operator_id: 'op-alice',
        pack_id: 'pack-1',
        binding_type: PACK_BINDING_TYPE.MEMBER,
        bound_at: now,
        created_at: now
      }
    })
    // root 绑定到 pack-1
    await kit.prisma.operatorPackBinding.create({
      data: {
        operator_id: 'op-root',
        pack_id: 'pack-1',
        binding_type: PACK_BINDING_TYPE.OWNER,
        bound_at: now,
        created_at: now
      }
    })
  })

  afterAll(async () => {
    await kit[Symbol.asyncDispose]()
  })

  it('allows bound member to access pack', async () => {
    const result = await checkPackAccess(kit.context, 'op-alice', 'pack-1')
    expect(result.allowed).toBe(true)
    expect(result.bindingType).toBe('member')
  })

  it('denies unbound operator from different pack', async () => {
    const result = await checkPackAccess(kit.context, 'op-alice', 'pack-2')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('NOT_BOUND')
  })

  it('allows bound root to access pack', async () => {
    const result = await checkPackAccess(kit.context, 'op-root', 'pack-1')
    expect(result.allowed).toBe(true)
    expect(result.bindingType).toBe('owner')
  })

  it('denies root without binding', async () => {
    // root 没有 pack-2 的绑定
    const result = await checkPackAccess(kit.context, 'op-root', 'pack-2')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('NOT_BOUND')
  })

  it('detects different binding types correctly', async () => {
    // 添加 spectator 绑定
    await kit.prisma.operatorPackBinding.create({
      data: {
        operator_id: 'op-alice',
        pack_id: 'pack-3',
        binding_type: PACK_BINDING_TYPE.SPECTATOR,
        bound_at: currentTick(),
        created_at: currentTick()
      }
    })

    const member = await checkPackAccess(kit.context, 'op-alice', 'pack-1')
    expect(member.bindingType).toBe('member')

    const spectator = await checkPackAccess(kit.context, 'op-alice', 'pack-3')
    expect(spectator.bindingType).toBe('spectator')
  })
})
