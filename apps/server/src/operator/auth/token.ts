import crypto from 'crypto'
import jwt from 'jsonwebtoken'

import type { DataContext } from '../../app/context.js'
import { resolvePackTick } from '../../app/services/pack/pack_runtime_resolution.js';
import { getOperatorAuthConfig } from '../../config/runtime_config.js'
import type { JwtPayload, OperatorContext } from './types.js'

const getJwtSecret = (): jwt.Secret => {
  return getOperatorAuthConfig().jwt_secret
}

const getJwtExpiresIn = (): string => {
  return getOperatorAuthConfig().jwt_expires_in
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions)
}

export const verifyToken = (token: string): JwtPayload | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
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
  context: DataContext,
  operatorId: string,
  token: string,
  packId?: string | null
): Promise<void> => {
  const tokenHash = computeTokenHash(token)

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
  const decoded = jwt.decode(token) as JwtPayload | null
  const expiresAt = decoded?.exp
    ? BigInt(decoded.exp * 1000)
    : resolvePackTick(context)

  await context.repos.identityOperator.createSession({
    operator_id: operatorId,
    token_hash: tokenHash,
    pack_id: packId ?? null,
    expires_at: expiresAt,
    created_at: resolvePackTick(context)
  })
}

export const destroySession = async (
  context: DataContext,
  token: string
): Promise<boolean> => {
  const tokenHash = computeTokenHash(token)

  const deleted = await context.repos.identityOperator.deleteSessionsByTokenHash(tokenHash)

  return deleted.count > 0
}

export const findActiveSession = async (
  context: DataContext,
  token: string
): Promise<{ operatorId: string; packId: string | null } | null> => {
  const tokenHash = computeTokenHash(token)
  const now = resolvePackTick(context)

  const session = await context.repos.identityOperator.findSessionByTokenHash(tokenHash, now)

  if (!session) {
    return null
  }

  return {
    operatorId: session.operator_id,
    packId: session.pack_id
  }
}
