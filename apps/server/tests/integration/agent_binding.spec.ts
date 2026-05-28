import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createAgentBinding,
  listAgentOperators,
  unbindAgent} from '../../src/app/services/operator/operator_agent_bindings.js'
import { OPERATOR_STATUS } from '../../src/operator/constants.js'
import { expectDefined } from '../helpers/assertions.js'
import { TestKit } from '../testkit.js'

describe('agent binding integration', () => {
  let kit: TestKit
  const currentTick = () => expectDefined(kit.context.packRuntime, 'pack runtime').getCurrentTick()

  beforeAll(async () => {
    kit = await TestKit.create()

    const now = currentTick()

    // 创建 operator
    await kit.prisma.identity.create({
      data: { id: 'identity-op-1', type: 'user', name: 'alice', provider: 'operator', status: 'active', created_at: now, updated_at: now }
    })
    await kit.prisma.operator.create({
      data: { id: 'op-1', identity_id: 'identity-op-1', username: 'alice', password_hash: 'hash', is_root: false, status: OPERATOR_STATUS.ACTIVE, created_at: now, updated_at: now }
    })

    // 创建 agent
    await kit.prisma.agent.create({
      data: { id: 'agent-test', name: 'TestAgent', type: 'active', created_at: now, updated_at: now }
    })
  })

  afterAll(async () => {
    await kit[Symbol.asyncDispose]()
  })

  it('creates agent binding for operator', async () => {
    const binding = await createAgentBinding(kit.context, 'agent-test', 'identity-op-1', 'active', 'op-1')

    expect(binding.identity_id).toBe('identity-op-1')
    expect(binding.agent_id).toBe('agent-test')
    expect(binding.role).toBe('active')
    expect(binding.status).toBe('active')
  })

  it('prevents duplicate active binding', async () => {
    await expect(
      createAgentBinding(kit.context, 'agent-test', 'identity-op-1', 'active', 'op-1')
    ).rejects.toThrow('Agent binding already exists')
  })

  it('unbinds agent', async () => {
    const result = await unbindAgent(kit.context, 'agent-test', 'identity-op-1', 'op-1')

    expect(result.unbound).toBe(true)
  })

  it('re-binds after unbind', async () => {
    const binding = await createAgentBinding(kit.context, 'agent-test', 'identity-op-1', 'active', 'op-1')

    expect(binding.status).toBe('active')
  })

  it('lists operators for agent', async () => {
    const operators = await listAgentOperators(kit.context, 'agent-test')

    expect(operators.length).toBeGreaterThanOrEqual(1)
    expect(operators[0].identity_id).toBe('identity-op-1')
  })
})
