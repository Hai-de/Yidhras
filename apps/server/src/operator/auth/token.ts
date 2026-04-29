import crypto from 'crypto'
import * as jwt from 'jsonwebtoken'

import type { AppInfrastructure } from '../../app/context.js'
import { getOperatorAuthConfig } from '../../config/runtime_config.js'
import type { JwtPayload, OperatorContext } from './types.js'

const getJwtSecret = (): jwt.Secret => {
  return getOperatorAuthConfig().jwt_secret as string
}

const getJwtExpiresIn = (): string => {
  return getOperatorAuthConfig().jwt_expires_in as string
}

export const signToken = (operator: OperatorContext): string => {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: operator.id,
    identity_id: operator.identity_id,
    username: operator.username,
    is_root: operator.is_root
  }

  const secret = getJwtSecret()
  const expiresIn = getJwtExpiresIn()
  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions)
}

export const verifyToken = (token: string): JwtPayload | null => {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as JwtPayload
    return payload
  } catch {
    return null
  }
}

export const computeTokenHash = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export const createSession = async (
  context: AppInfrastructure,
  operatorId: string,
  token: string,
  packId?: string | null
): Promise<void> => {
  const tokenHash = computeTokenHash(token)

  const decoded = jwt.decode(token) as JwtPayload | null
  const expiresAt = decoded?.exp
    ? BigInt(decoded.exp * 1000)
    : context.clock.getCurrentTick()

  await context.repos.identityOperator.createSession({
    operator_id: operatorId,
    token_hash: tokenHash,
    pack_id: packId ?? null,
    expires_at: expiresAt,
    created_at: context.clock.getCurrentTick()
  })
}

export const destroySession = async (
  context: AppInfrastructure,
  token: string
): Promise<boolean> => {
  const tokenHash = computeTokenHash(token)

  const deleted = await context.repos.identityOperator.deleteSessionsByTokenHash(tokenHash)

  return deleted.count > 0
}

export const findActiveSession = async (
  context: AppInfrastructure,
  token: string
): Promise<{ operatorId: string; packId: string | null } | null> => {
  const tokenHash = computeTokenHash(token)
  const now = context.clock.getCurrentTick()

  const session = await context.repos.identityOperator.findSessionByTokenHash(tokenHash, now)

  if (!session) {
    return null
  }

  return {
    operatorId: session.operator_id,
    packId: session.pack_id
  }
}
