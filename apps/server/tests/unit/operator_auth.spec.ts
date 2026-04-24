import { describe, expect, it } from 'vitest'

import { comparePassword, hashPassword } from '../../src/operator/auth/password.js'

const PLAIN_PASSWORD = 'test-secure-password-123'

describe('operator auth password', () => {
  it('hashes a password and returns a bcrypt string', async () => {
    const hash = await hashPassword(PLAIN_PASSWORD, 4)

    expect(hash).toBeTypeOf('string')
    expect(hash.startsWith('$2')).toBe(true)
  })

  it('compares a correct password and returns true', async () => {
    const hash = await hashPassword(PLAIN_PASSWORD, 4)
    const result = await comparePassword(PLAIN_PASSWORD, hash)

    expect(result).toBe(true)
  })

  it('compares an incorrect password and returns false', async () => {
    const hash = await hashPassword(PLAIN_PASSWORD, 4)
    const result = await comparePassword('wrong-password', hash)

    expect(result).toBe(false)
  })

  it('generates different hashes for same password with different salts', async () => {
    const hash1 = await hashPassword(PLAIN_PASSWORD, 4)
    const hash2 = await hashPassword(PLAIN_PASSWORD, 4)

    expect(hash1).not.toBe(hash2)
  })
})
