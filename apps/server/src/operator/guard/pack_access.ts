import type { NextFunction,Response } from 'express'

import type { DataContext } from '../../app/context.js'
import { ApiError } from '../../utils/api_error.js'
import { logOperatorAudit } from '../audit/logger.js'
import type { OperatorRequest } from '../auth/types.js'
import {
  AUDIT_ACTION,
  OPERATOR_ERROR_CODE,
  PACK_BINDING_TYPE_LEVEL,
  type PackBindingType
} from '../constants.js'
import type { PackAccessGuardOptions,PackAccessResult } from './types.js'

export const checkPackAccess = async (
  context: DataContext,
  operatorId: string,
  packId: string
): Promise<PackAccessResult> => {
  const binding = await context.repos.identityOperator.findPackBinding(operatorId, packId)

  if (!binding) {
    return { allowed: false, bindingType: null, reason: 'NOT_BOUND' }
  }

  return {
    allowed: true,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    bindingType: binding.binding_type as PackBindingType
  }
}

const bindingTypeRank: Record<string, number> = PACK_BINDING_TYPE_LEVEL

export const packAccessGuard = (
  context: DataContext,
  options: PackAccessGuardOptions = {}
) => {
  return (
    req: OperatorRequest,
    _res: Response,
    next: NextFunction
  ): void => {
    const run = async (): Promise<void> => {
      const packId = options.packIdParam
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express query/param value
        ? (req.params[options.packIdParam] as string | undefined)
        : options.packIdQuery
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express query/param value
          ? (req.query[options.packIdQuery] as string | undefined)
          : undefined

      if (!packId) {
        next()
        return
      }

      if (!req.operator) {
        if (options.allowPublic) {
          next()
          return
        }
        throw new ApiError(
          401,
          OPERATOR_ERROR_CODE.OPERATOR_REQUIRED,
          'Authentication required'
        )
      }

      if (req.operator.is_root) {
        next()
        return
      }

      const access = await checkPackAccess(context, req.operator.id, packId)

      if (!access.allowed) {
        await logOperatorAudit(context, {
          operator_id: req.operator.id,
          pack_id: packId,
          action: AUDIT_ACTION.PACK_ACCESS_DENIED,
          detail_json: { reason: access.reason },
          client_ip: req.ip
        })

        throw new ApiError(
          403,
          OPERATOR_ERROR_CODE.PACK_ACCESS_DENIED,
          `Operator not bound to pack: ${packId}`,
          { reason: access.reason }
        )
      }

      if (
        options.minBindingType &&
        access.bindingType &&
        (bindingTypeRank[access.bindingType] ?? 0) <
          (bindingTypeRank[options.minBindingType] ?? 0)
      ) {
        throw new ApiError(
          403,
          OPERATOR_ERROR_CODE.PACK_ACCESS_DENIED,
          `Insufficient binding type: need ${options.minBindingType}, got ${access.bindingType}`
        )
      }

      next()
    }

    run().catch(next)
  }
}
