import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createOperatorGrant,
  listOperatorGrants,
  revokeOperatorGrant
} from '../../src/app/services/operator/operator_grants.js'
import { OPERATOR_STATUS } from '../../src/operator/constants.js'
import { expectDefined } from '../helpers/assertions.js'
import { TestKit } from '../testkit.js'

describe('operator grant integration', () => {
  let kit: TestKit
  const currentTick = () => expectDefined(kit.context.packRuntime, 'pack runtime').getCurrentTick()

  beforeAll(async () => {
    kit = await TestKit.create()

    const now = currentTick()

    await kit.prisma.identity.createMany({
      data: [
        { id: 'identity-giver', type: 'user', name: 'giver', provider: 'operator', status: 'active', created_at: now, updated_at: now },
        { id: 'identity-receiver', type: 'user', name: 'receiver', provider: 'operator', status: 'active', created_at: now, updated_at: now }
      ]
    })
    await kit.prisma.operator.createMany({
      data: [
        { id: 'op-giver', identity_id: 'identity-giver', username: 'giver', password_hash: 'hash', is_root: false, status: OPERATOR_STATUS.ACTIVE, created_at: now, updated_at: now },
        { id: 'op-receiver', identity_id: 'identity-receiver', username: 'receiver', password_hash: 'hash', is_root: false, status: OPERATOR_STATUS.ACTIVE, created_at: now, updated_at: now }
      ]
    })
  })

  afterAll(async () => {
    await kit[Symbol.asyncDispose]()
  })

  it('creates a grant', async () => {
    const grant = await createOperatorGrant(kit.context, 'pack-1', 'op-giver', 'identity-receiver', 'perceive.agent.logs')

    expect(grant.giver_operator_id).toBe('op-giver')
    expect(grant.receiver_identity_id).toBe('identity-receiver')
    expect(grant.capability_key).toBe('perceive.agent.logs')
    expect(grant.revocable).toBe(true)
  })

  it('lists grants by giver', async () => {
    const grants = await listOperatorGrants(kit.context, 'pack-1', 'op-giver')

    expect(grants.length).toBeGreaterThanOrEqual(1)
    expect(expectDefined(grants[0], 'first grant').giver_operator_id).toBe('op-giver')
  })

  it('revokes a grant', async () => {
    const grant = await createOperatorGrant(kit.context, 'pack-1', 'op-giver', 'identity-receiver', 'perceive.entity.overview')

    const result = await revokeOperatorGrant(kit.context, grant.id, 'op-giver')
    expect(result.revoked).toBe(true)

    const grants = await listOperatorGrants(kit.context, 'pack-1', 'op-giver')
    expect(grants.find(g => g.id === grant.id)).toBeUndefined()
  })

  it('prevents non-owner from revoking', async () => {
    const grant = await createOperatorGrant(kit.context, 'pack-1', 'op-giver', 'identity-receiver', 'invoke.agent.decide')

    await expect(
      revokeOperatorGrant(kit.context, grant.id, 'op-receiver')
    ).rejects.toThrow('Only the grant owner can revoke')
  })

  it('errors on non-existent grant', async () => {
    await expect(
      revokeOperatorGrant(kit.context, 'non-existent-grant', 'op-giver')
    ).rejects.toThrow('Grant not found')
  })

  it('creates grant with TTL expires_at', async () => {
    const now = currentTick()
    const futureTick = now + 1000n

    const grant = await createOperatorGrant(kit.context, 'pack-1', 'op-giver', 'identity-receiver', 'perceive.agent.scheduler', {
      expires_at: futureTick
    })

    expect(grant.expires_at).toBe(futureTick)
  })

  it('rejects grant with past expires_at', async () => {
    const pastTick = currentTick() - 1n

    await expect(
      createOperatorGrant(kit.context, 'pack-1', 'op-giver', 'identity-receiver', 'perceive.agent.scheduler', {
        expires_at: pastTick
      })
    ).rejects.toThrow('expires_at must be in the future')
  })
})
