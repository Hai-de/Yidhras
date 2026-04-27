import { logOperatorAudit } from '../../operator/audit/logger.js'
import { AUDIT_ACTION } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'

export const createPackBinding = async (
  context: AppContext,
  packId: string,
  operatorId: string,
  bindingType: string,
  boundByOperatorId?: string,
  clientIp?: string
) => {
  const existing = await context.prisma.operatorPackBinding.findUnique({
    where: {
      operator_id_pack_id: {
        operator_id: operatorId,
        pack_id: packId
      }
    }
  })

  if (existing) {
    throw new ApiError(409, 'BINDING_ALREADY_EXISTS', 'Operator already bound to this pack')
  }

  const now = context.clock.getCurrentTick()

  const binding = await context.prisma.operatorPackBinding.create({
    data: {
      operator_id: operatorId,
      pack_id: packId,
      binding_type: bindingType,
      bound_at: now,
      bound_by: boundByOperatorId ?? null,
      created_at: now
    }
  })

  await logOperatorAudit(context, {
    operator_id: boundByOperatorId ?? null,
    pack_id: packId,
    action: AUDIT_ACTION.BIND_PACK,
    target_id: operatorId,
    detail_json: { binding_type: bindingType },
    client_ip: clientIp ?? null
  })

  return binding
}

export const listPackBindings = async (
  context: AppContext,
  packId: string
) => {
  return context.prisma.operatorPackBinding.findMany({
    where: { pack_id: packId },
    include: {
      operator: {
        select: {
          id: true,
          username: true,
          is_root: true,
          display_name: true
        }
      }
    },
    orderBy: { created_at: 'asc' }
  })
}

export const updatePackBinding = async (
  context: AppContext,
  packId: string,
  targetOperatorId: string,
  bindingType: string,
  updatedByOperatorId?: string,
  clientIp?: string
) => {
  const binding = await context.prisma.operatorPackBinding.findUnique({
    where: {
      operator_id_pack_id: {
        operator_id: targetOperatorId,
        pack_id: packId
      }
    }
  })

  if (!binding) {
    throw new ApiError(404, 'BINDING_NOT_FOUND', 'Pack binding not found')
  }

  const updated = await context.prisma.operatorPackBinding.update({
    where: {
      operator_id_pack_id: {
        operator_id: targetOperatorId,
        pack_id: packId
      }
    },
    data: { binding_type: bindingType }
  })

  await logOperatorAudit(context, {
    operator_id: updatedByOperatorId ?? null,
    pack_id: packId,
    action: AUDIT_ACTION.BIND_PACK,
    target_id: targetOperatorId,
    detail_json: { binding_type: bindingType, previous: binding.binding_type },
    client_ip: clientIp ?? null
  })

  return updated
}

export const removePackBinding = async (
  context: AppContext,
  packId: string,
  targetOperatorId: string,
  removedByOperatorId?: string,
  clientIp?: string
) => {
  const binding = await context.prisma.operatorPackBinding.findUnique({
    where: {
      operator_id_pack_id: {
        operator_id: targetOperatorId,
        pack_id: packId
      }
    }
  })

  if (!binding) {
    throw new ApiError(404, 'BINDING_NOT_FOUND', 'Pack binding not found')
  }

  await context.prisma.operatorPackBinding.delete({
    where: {
      operator_id_pack_id: {
        operator_id: targetOperatorId,
        pack_id: packId
      }
    }
  })

  await logOperatorAudit(context, {
    operator_id: removedByOperatorId ?? null,
    pack_id: packId,
    action: AUDIT_ACTION.UNBIND_PACK,
    target_id: targetOperatorId,
    client_ip: clientIp ?? null
  })

  return { removed: true }
}

export const listMyPackBindings = async (
  context: AppContext,
  operatorId: string
) => {
  return context.prisma.operatorPackBinding.findMany({
    where: { operator_id: operatorId },
    orderBy: { created_at: 'desc' }
  })
}
