import type { NextFunction,Response } from 'express'

import { logOperatorAudit } from '../../operator/audit/logger.js'
import type { OperatorRequest } from '../../operator/auth/types.js'
import {
  AUDIT_ACTION,
  OPERATOR_ERROR_CODE
} from '../../operator/constants.js'
import { checkPackAccess } from '../../operator/guard/pack_access.js'
import type { CapabilityCheckResult, CapabilityGuardOptions } from '../../operator/guard/types.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'

/**
 * 检查 Operator 是否拥有指定 capability。
 * 检查顺序：
 * 1. root → 直接通过（root 可做任何操作，但仍需 pack binding）
 * 2. OperatorGrant 委托
 * 3. 暂不接入 AuthorityResolver（P3）
 */
export const checkCapability = async (
  context: AppContext,
  operatorId: string,
  packId: string,
  capabilityKey: string,
  _targetAgentId?: string
): Promise<CapabilityCheckResult> => {
  // 查 operator
  const operator = await context.prisma.operator.findUnique({
    where: { id: operatorId }
  })

  if (!operator) {
    return {
      allowed: false,
      matchedGrant: null,
      subjectEntityId: null,
      fromOperatorGrant: false,
      operatorGrantId: null
    }
  }

  // root → 通过
  if (operator.is_root) {
    return {
      allowed: true,
      matchedGrant: null,
      subjectEntityId: operator.identity_id,
      fromOperatorGrant: false,
      operatorGrantId: null
    }
  }

  // 查 OperatorGrant 委托
  const now = context.sim.getCurrentTick()
  const grant = await context.prisma.operatorGrant.findFirst({
    where: {
      receiver_identity_id: operator.identity_id,
      pack_id: packId,
      capability_key: capabilityKey,
      OR: [
        { expires_at: null },
        { expires_at: { gt: now } }
      ]
    },
    orderBy: { created_at: 'desc' }
  })

  if (grant) {
    return {
      allowed: true,
      matchedGrant: null,
      subjectEntityId: operator.identity_id,
      fromOperatorGrant: true,
      operatorGrantId: grant.id
    }
  }

  return {
    allowed: false,
    matchedGrant: null,
    subjectEntityId: operator.identity_id,
    fromOperatorGrant: false,
    operatorGrantId: null
  }
}

/**
 * Capability Guard 中间件工厂。
 * 检查：Operator 认证 → Pack Access (L1) → Capability (L2)
 */
export const capabilityGuard = (
  context: AppContext,
  capabilityKey: string,
  options: CapabilityGuardOptions = {}
) => {
  return async (
    req: OperatorRequest,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    // 提取 packId
    const packId = options.packIdParam
      ? (req.params[options.packIdParam] as string | undefined)
      : options.packIdQuery
        ? (req.query[options.packIdQuery] as string | undefined)
        : undefined

    if (!packId) {
      throw new ApiError(400, 'PACK_ID_REQUIRED', 'Pack ID is required for capability check')
    }

    // 需要 operator 认证
    if (!req.operator) {
      throw new ApiError(
        401,
        OPERATOR_ERROR_CODE.OPERATOR_REQUIRED,
        'Authentication required'
      )
    }

    // L1: Pack Access
    const access = await checkPackAccess(context, req.operator.id, packId)
    if (!access.allowed) {
      await logOperatorAudit(context, {
        operator_id: req.operator.id,
        pack_id: packId,
        action: AUDIT_ACTION.PACK_ACCESS_DENIED,
        detail_json: { reason: access.reason, capability_key: capabilityKey },
        client_ip: req.ip
      })

      throw new ApiError(
        403,
        OPERATOR_ERROR_CODE.PACK_ACCESS_DENIED,
        `Operator not bound to pack: ${packId}`
      )
    }

    // L2: Capability
    const targetAgentId = options.targetAgentIdParam
      ? (req.params[options.targetAgentIdParam] as string | undefined)
      : undefined

    const result = await checkCapability(
      context,
      req.operator.id,
      packId,
      capabilityKey,
      targetAgentId
    )

    if (!result.allowed) {
      await logOperatorAudit(context, {
        operator_id: req.operator.id,
        pack_id: packId,
        action: AUDIT_ACTION.CAPABILITY_DENIED,
        detail_json: {
          capability_key: capabilityKey,
          subject_entity_id: result.subjectEntityId
        },
        client_ip: req.ip
      })

      throw new ApiError(
        403,
        OPERATOR_ERROR_CODE.CAPABILITY_DENIED,
        `Missing capability: ${capabilityKey}`,
        {
          capability_key: capabilityKey,
          subject_entity_id: result.subjectEntityId
        }
      )
    }

    next()
  }
}
