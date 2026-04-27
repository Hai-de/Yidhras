import type { Prisma } from '@prisma/client'

import { logOperatorAudit } from '../../operator/audit/logger.js'
import { AUDIT_ACTION } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'

export const createOperatorGrant = async (
  context: AppContext,
  packId: string,
  giverOperatorId: string,
  receiverIdentityId: string,
  capabilityKey: string,
  options?: {
    scope_json?: Record<string, unknown>
    revocable?: boolean
    expires_at?: bigint | null
  },
  clientIp?: string
) => {
  const now = context.clock.getCurrentTick()

  // 检查 expires_at 有效性
  if (options?.expires_at && options.expires_at <= now) {
    throw new ApiError(400, 'GRANT_INVALID', 'expires_at must be in the future')
  }

  const grant = await context.prisma.operatorGrant.create({
    data: {
      giver_operator_id: giverOperatorId,
      receiver_identity_id: receiverIdentityId,
      pack_id: packId,
      capability_key: capabilityKey,
      scope_json: options?.scope_json as Prisma.InputJsonValue | undefined ?? undefined,
      revocable: options?.revocable ?? true,
      expires_at: options?.expires_at ?? null,
      created_at: now
    }
  })

  await logOperatorAudit(context, {
    operator_id: giverOperatorId,
    pack_id: packId,
    action: AUDIT_ACTION.GRANT_CAPABILITY,
    target_id: receiverIdentityId,
    detail_json: { capability_key: capabilityKey },
    client_ip: clientIp ?? null
  })

  return grant
}

export const listOperatorGrants = async (
  context: AppContext,
  packId: string,
  giverOperatorId: string
) => {
  return context.prisma.operatorGrant.findMany({
    where: {
      giver_operator_id: giverOperatorId,
      pack_id: packId
    },
    orderBy: { created_at: 'desc' }
  })
}

export const revokeOperatorGrant = async (
  context: AppContext,
  grantId: string,
  operatorId: string,
  clientIp?: string
) => {
  const grant = await context.prisma.operatorGrant.findUnique({
    where: { id: grantId }
  })

  if (!grant) {
    throw new ApiError(404, 'GRANT_NOT_FOUND', 'Grant not found')
  }

  if (grant.giver_operator_id !== operatorId) {
    throw new ApiError(403, 'GRANT_INVALID', 'Only the grant owner can revoke')
  }

  await context.prisma.operatorGrant.delete({
    where: { id: grantId }
  })

  await logOperatorAudit(context, {
    operator_id: operatorId,
    pack_id: grant.pack_id,
    action: AUDIT_ACTION.REVOKE_GRANT,
    target_id: grantId,
    detail_json: { capability_key: grant.capability_key },
    client_ip: clientIp ?? null
  })

  return { revoked: true }
}
