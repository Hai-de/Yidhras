import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { AppContext } from '../../src/app/context.js'
import {
  createAgentBinding,
  listAgentOperators,
  unbindAgent} from '../../src/app/services/operator_agent_bindings.js'
import { OPERATOR_STATUS } from '../../src/operator/constants.js'
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js'

describe('agent binding integration', () => {
  let cleanup: (() => Promise<void>) | null = null
  let context: AppContext

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture()
    cleanup = fixture.cleanup
    context = fixture.context

    const now = context.sim.getCurrentTick()

    // 创建 operator
    await context.prisma.identity.create({
      data: { id: 'identity-op-1', type: 'user', name: 'alice', provider: 'operator', status: 'active', created_at: now, updated_at: now }
    })
    await context.prisma.operator.create({
      data: { id: 'op-1', identity_id: 'identity-op-1', username: 'alice', password_hash: 'hash', is_root: false, status: OPERATOR_STATUS.ACTIVE, created_at: now, updated_at: now }
    })

    // 创建 agent
    await context.prisma.agent.create({
      data: { id: 'agent-test', name: 'TestAgent', type: 'active', created_at: now, updated_at: now }
    })
  })

  afterAll(async () => {
    await cleanup?.()
  })

  it('creates agent binding for operator', async () => {
    const binding = await createAgentBinding(context, 'agent-test', 'identity-op-1', 'active', 'op-1')

    expect(binding.identity_id).toBe('identity-op-1')
    expect(binding.agent_id).toBe('agent-test')
    expect(binding.role).toBe('active')
    expect(binding.status).toBe('active')
  })

  it('prevents duplicate active binding', async () => {
    await expect(
      createAgentBinding(context, 'agent-test', 'identity-op-1', 'active', 'op-1')
    ).rejects.toThrow('Agent binding already exists')
  })

  it('unbinds agent', async () => {
    const result = await unbindAgent(context, 'agent-test', 'identity-op-1', 'op-1')

    expect(result.unbound).toBe(true)
  })

  it('re-binds after unbind', async () => {
    const binding = await createAgentBinding(context, 'agent-test', 'identity-op-1', 'active', 'op-1')

    expect(binding.status).toBe('active')
  })

  it('lists operators for agent', async () => {
    const operators = await listAgentOperators(context, 'agent-test')

    expect(operators.length).toBeGreaterThanOrEqual(1)
    expect(operators[0].identity_id).toBe('identity-op-1')
  })
})
