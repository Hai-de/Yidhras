import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hashPassword } from '../../src/operator/auth/password.js'
import { PACK_BINDING_TYPE } from '../../src/operator/constants.js'
import { createIsolatedRuntimeEnvironment, prepareIsolatedRuntime } from '../helpers/runtime.js'
import type { RunningServer } from '../support/helpers.js'
import { isRecord, requestJson } from '../support/helpers.js'

describe('operator auth e2e', () => {
  let server: RunningServer | null = null
  let cleanup: (() => Promise<void>) | null = null
  let rootToken = ''
  let aliceToken = ''

  const ROOT_PASSWORD = 'e2e-root-password'

  beforeAll(async () => {
    const env = await createIsolatedRuntimeEnvironment({
      envOverrides: {
        OPERATOR_JWT_SECRET: 'e2e-test-jwt-secret-at-least-16-chars',
        OPERATOR_JWT_EXPIRES_IN: '1h',
        OPERATOR_ROOT_DEFAULT_PASSWORD: ROOT_PASSWORD
      }
    })
    cleanup = env.cleanup

    await prepareIsolatedRuntime(env, 120_000)

    // 手动 seed operator 数据
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient({
      datasources: { db: { url: env.databaseUrl } }
    })

    const now = BigInt(Date.now())
    const rootPasswordHash = await hashPassword(ROOT_PASSWORD, 4)

    // root Operator
    await prisma.identity.upsert({
      where: { id: 'identity-root' },
      update: {},
      create: { id: 'identity-root', type: 'user', name: 'root', provider: 'operator', status: 'active', created_at: now, updated_at: now }
    })
    await prisma.operator.deleteMany({ where: { username: 'root' } })
    await prisma.operator.create({
      data: { id: 'op-root', identity_id: 'identity-root', username: 'root', password_hash: rootPasswordHash, is_root: true, status: 'active', created_at: now, updated_at: now }
    })

    // Alice Operator
    await prisma.identity.upsert({
      where: { id: 'identity-alice' },
      update: {},
      create: { id: 'identity-alice', type: 'user', name: 'alice', provider: 'operator', status: 'active', created_at: now, updated_at: now }
    })
    const alicePasswordHash = await hashPassword('alice-password', 4)
    await prisma.operator.deleteMany({ where: { username: 'alice' } })
    await prisma.operator.create({
      data: { id: 'op-alice', identity_id: 'identity-alice', username: 'alice', password_hash: alicePasswordHash, is_root: false, status: 'active', created_at: now, updated_at: now }
    })

    // root 绑定到默认 pack
    const preferredPack = process.env.WORLD_PACK || 'example_pack'
    await prisma.operatorPackBinding.create({
      data: { operator_id: 'op-root', pack_id: preferredPack, binding_type: PACK_BINDING_TYPE.OWNER, bound_at: now, created_at: now }
    })

    // Agent
    await prisma.agent.upsert({
      where: { id: 'agent-001' },
      update: {},
      create: { id: 'agent-001', name: 'Agent-001', type: 'active', created_at: now, updated_at: now }
    })

    await prisma.$disconnect()

    // 启动服务器
    const { startServer } = await import('../support/helpers.js')
    server = await startServer({
      port: 0,
      startupTimeoutMs: 60_000,
      prepareRuntime: false,
      envOverrides: env.envOverrides
    })
  }, 180_000)

  afterAll(async () => {
    if (server) {
      await server.stop()
    }
    await cleanup?.()
  })

  it('POST /api/auth/login — logs in root operator', async () => {
    const res = await requestJson(server!.baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: ROOT_PASSWORD })
    })

    expect(res.status).toBe(200)
    const body = isRecord(res.body) ? res.body : {}
    expect(body.success).toBe(true)
    expect(isRecord(body.data) ? body.data.token : '').toBeTypeOf('string')
    rootToken = isRecord(body.data) ? String(body.data.token) : ''
    expect(rootToken.length).toBeGreaterThan(0)
  })

  it('POST /api/auth/login — rejects invalid credentials', async () => {
    const res = await requestJson(server!.baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'wrong-password' })
    })

    expect(res.status).toBe(401)
  })

  it('GET /api/auth/session — returns operator info', async () => {
    const res = await requestJson(server!.baseUrl, '/api/auth/session', {
      headers: { Authorization: `Bearer ${rootToken}` }
    })

    expect(res.status).toBe(200)
    const body = isRecord(res.body) ? res.body : {}
    const data = isRecord(body.data) ? body.data : null
    expect(data?.operator).toBeDefined()
  })

  it('POST /api/operators — root creates operator alice', async () => {
    const res = await requestJson(server!.baseUrl, '/api/operators', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rootToken}`
      },
      body: JSON.stringify({ username: 'alice-new', password: 'alice-password-123' })
    })

    expect(res.status).toBe(200)
  })

  it('POST /api/packs/:packId/bindings — root binds alice to pack', async () => {
    const preferredPack = process.env.WORLD_PACK || 'example_pack'
    const res = await requestJson(server!.baseUrl, `/api/packs/${preferredPack}/bindings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rootToken}`
      },
      body: JSON.stringify({ operator_id: 'op-alice', binding_type: 'member' })
    })

    expect(res.status).toBe(200)
  })

  it('POST /api/auth/login — alice logs in', async () => {
    const res = await requestJson(server!.baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'alice-password' })
    })

    expect(res.status).toBe(200)
    const body = isRecord(res.body) ? res.body : {}
    aliceToken = isRecord(body.data) ? String(body.data.token) : ''
    expect(aliceToken.length).toBeGreaterThan(0)
  })

  it('POST /api/auth/logout — logs out alice', async () => {
    const res = await requestJson(server!.baseUrl, '/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` }
    })

    expect(res.status).toBe(200)
  })
})
