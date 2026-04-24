import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { AppContext } from '../../src/app/context.js'
import { comparePassword,hashPassword } from '../../src/operator/auth/password.js'
import {
  computeTokenHash,
  createSession,
  destroySession,
  findActiveSession,
  signToken,
  verifyToken} from '../../src/operator/auth/token.js'
import { OPERATOR_STATUS } from '../../src/operator/constants.js'
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js'

describe('operator auth integration', () => {
  let cleanup: (() => Promise<void>) | null = null
  let context: AppContext

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture()
    cleanup = fixture.cleanup
    context = fixture.context

    // 注入测试 operator
    const now = context.sim.getCurrentTick()
    const passwordHash = await hashPassword('test-password', 4)
    await context.prisma.identity.create({
      data: {
        id: 'identity-test-1',
        type: 'user',
        name: 'testuser',
        provider: 'operator',
        status: 'active',
        created_at: now,
        updated_at: now
      }
    })
    await context.prisma.operator.create({
      data: {
        id: 'op-test-1',
        identity_id: 'identity-test-1',
        username: 'testuser',
        password_hash: passwordHash,
        is_root: false,
        status: OPERATOR_STATUS.ACTIVE,
        created_at: now,
        updated_at: now
      }
    })
  })

  afterAll(async () => {
    await cleanup?.()
  })

  describe('password', () => {
    it('hashes and verifies password correctly', async () => {
      const hash = await hashPassword('my-password', 4)
      const valid = await comparePassword('my-password', hash)
      const invalid = await comparePassword('wrong', hash)

      expect(valid).toBe(true)
      expect(invalid).toBe(false)
    })
  })

  describe('token', () => {
    it('signs and verifies JWT token', () => {
      const token = signToken({
        id: 'op-test-1',
        identity_id: 'identity-test-1',
        username: 'testuser',
        is_root: false,
        status: 'active',
        display_name: null
      })

      const payload = verifyToken(token)

      expect(payload).not.toBeNull()
      expect(payload!.sub).toBe('op-test-1')
      expect(payload!.username).toBe('testuser')
      expect(payload!.is_root).toBe(false)
    })

    it('returns null for invalid token', () => {
      const payload = verifyToken('invalid-token')
      expect(payload).toBeNull()
    })

    it('creates and finds active session', async () => {
      const token = signToken({
        id: 'op-test-1',
        identity_id: 'identity-test-1',
        username: 'testuser',
        is_root: false,
        status: 'active',
        display_name: null
      })

      await createSession(context, 'op-test-1', token, 'pack-1')

      const session = await findActiveSession(context, token)
      expect(session).not.toBeNull()
      expect(session!.operatorId).toBe('op-test-1')
      expect(session!.packId).toBe('pack-1')
    })

    it('destroys session and returns null on find', async () => {
      const token = signToken({
        id: 'op-test-1',
        identity_id: 'identity-test-1',
        username: 'testuser',
        is_root: false,
        status: 'active',
        display_name: null
      })

      await createSession(context, 'op-test-1', token)
      const deleted = await destroySession(context, token)

      expect(deleted).toBe(true)

      const session = await findActiveSession(context, token)
      expect(session).toBeNull()
    })

    it('computes consistent token hash', () => {
      const token = 'test-token-value'
      const hash1 = computeTokenHash(token)
      const hash2 = computeTokenHash(token)

      expect(hash1).toBe(hash2)
      expect(hash1.length).toBe(64) // SHA-256 hex
    })
  })
})
