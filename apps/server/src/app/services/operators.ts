import { logOperatorAudit } from '../../operator/audit/logger.js'
import { hashPassword } from '../../operator/auth/password.js'
import { AUDIT_ACTION, OPERATOR_STATUS } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'

export const createOperator = async (
  context: AppContext,
  input: {
    username: string
    password: string
    display_name?: string
    is_root?: boolean
  },
  createdByOperatorId?: string,
  clientIp?: string
) => {
  const existing = await context.prisma.operator.findUnique({
    where: { username: input.username }
  })

  if (existing) {
    throw new ApiError(409, 'USERNAME_TAKEN', `Username '${input.username}' is already taken`)
  }

  const passwordHash = await hashPassword(input.password)
  const now = context.clock.getCurrentTick()

  // 创建 Identity
  const identity = await context.prisma.identity.create({
    data: {
      type: 'user',
      name: input.username,
      provider: 'operator',
      status: 'active',
      created_at: now,
      updated_at: now
    }
  })

  // 创建 Operator
  const operator = await context.prisma.operator.create({
    data: {
      identity_id: identity.id,
      username: input.username,
      password_hash: passwordHash,
      is_root: input.is_root ?? false,
      status: OPERATOR_STATUS.ACTIVE,
      display_name: input.display_name ?? null,
      created_at: now,
      updated_at: now
    }
  })

  await logOperatorAudit(context, {
    operator_id: createdByOperatorId ?? null,
    action: AUDIT_ACTION.CREATE_OPERATOR,
    target_id: operator.id,
    detail_json: { username: input.username, is_root: input.is_root ?? false },
    client_ip: clientIp ?? null
  })

  return operator
}

export const listOperators = async (context: AppContext) => {
  return context.prisma.operator.findMany({
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      username: true,
      is_root: true,
      status: true,
      display_name: true,
      created_at: true,
      updated_at: true
    }
  })
}

export const getOperator = async (context: AppContext, operatorId: string) => {
  const operator = await context.prisma.operator.findUnique({
    where: { id: operatorId },
    include: {
      pack_bindings: true
    }
  })

  if (!operator) {
    throw new ApiError(404, 'OPERATOR_NOT_FOUND', 'Operator not found')
  }

  return operator
}

export const updateOperator = async (
  context: AppContext,
  operatorId: string,
  input: {
    status?: string
    password?: string
    display_name?: string
    is_root?: boolean
  },
  updatedByOperatorId?: string,
  clientIp?: string
) => {
  const operator = await context.prisma.operator.findUnique({
    where: { id: operatorId }
  })

  if (!operator) {
    throw new ApiError(404, 'OPERATOR_NOT_FOUND', 'Operator not found')
  }

  const now = context.clock.getCurrentTick()
  const data: Record<string, unknown> = { updated_at: now }

  if (input.status !== undefined) {
    if (!Object.values(OPERATOR_STATUS).includes(input.status as typeof OPERATOR_STATUS[keyof typeof OPERATOR_STATUS])) {
      throw new ApiError(400, 'OPERATOR_INVALID', 'Invalid status')
    }
    data.status = input.status
  }

  if (input.password !== undefined) {
    data.password_hash = await hashPassword(input.password)
  }

  if (input.display_name !== undefined) {
    data.display_name = input.display_name
  }

  if (input.is_root !== undefined) {
    data.is_root = input.is_root
  }

  const updated = await context.prisma.operator.update({
    where: { id: operatorId },
    data
  })

  await logOperatorAudit(context, {
    operator_id: updatedByOperatorId ?? null,
    action: AUDIT_ACTION.UPDATE_OPERATOR,
    target_id: operatorId,
    detail_json: input as unknown as import('@prisma/client/runtime/library').JsonObject,
    client_ip: clientIp ?? null
  })

  return updated
}

export const deleteOperator = async (
  context: AppContext,
  operatorId: string,
  deletedByOperatorId?: string,
  clientIp?: string
) => {
  const operator = await context.prisma.operator.findUnique({
    where: { id: operatorId }
  })

  if (!operator) {
    throw new ApiError(404, 'OPERATOR_NOT_FOUND', 'Operator not found')
  }

  const now = context.clock.getCurrentTick()

  const updated = await context.prisma.operator.update({
    where: { id: operatorId },
    data: {
      status: OPERATOR_STATUS.DISABLED,
      updated_at: now
    }
  })

  await logOperatorAudit(context, {
    operator_id: deletedByOperatorId ?? null,
    action: AUDIT_ACTION.DELETE_OPERATOR,
    target_id: operatorId,
    client_ip: clientIp ?? null
  })

  return updated
}
