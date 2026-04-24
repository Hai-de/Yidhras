import { logOperatorAudit } from '../../operator/audit/logger.js'
import { comparePassword } from '../../operator/auth/password.js'
import {
  createSession,
  destroySession,
  signToken} from '../../operator/auth/token.js'
import type { LoginResponse, OperatorContext, SessionResponse } from '../../operator/auth/types.js'
import { AUDIT_ACTION,OPERATOR_STATUS  } from '../../operator/constants.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'

export const loginOperator = async (
  context: AppContext,
  username: string,
  password: string,
  packId?: string,
  clientIp?: string
): Promise<LoginResponse> => {
  const operator = await context.prisma.operator.findUnique({
    where: { username }
  })

  if (!operator) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password')
  }

  if (operator.status !== OPERATOR_STATUS.ACTIVE) {
    throw new ApiError(403, 'OPERATOR_DISABLED', 'Operator account is disabled or suspended')
  }

  const valid = await comparePassword(password, operator.password_hash)
  if (!valid) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password')
  }

  const operatorCtx: OperatorContext = {
    id: operator.id,
    identity_id: operator.identity_id,
    username: operator.username,
    is_root: operator.is_root,
    status: operator.status,
    display_name: operator.display_name
  }

  const token = signToken(operatorCtx)
  await createSession(context, operator.id, token, packId)

  await logOperatorAudit(context, {
    operator_id: operator.id,
    pack_id: packId ?? null,
    action: AUDIT_ACTION.LOGIN,
    client_ip: clientIp ?? null
  })

  return {
    token,
    operator: {
      id: operator.id,
      username: operator.username,
      is_root: operator.is_root,
      display_name: operator.display_name
    }
  }
}

export const logoutOperator = async (
  context: AppContext,
  token: string,
  operatorId: string,
  clientIp?: string
): Promise<void> => {
  await destroySession(context, token)

  await logOperatorAudit(context, {
    operator_id: operatorId,
    action: AUDIT_ACTION.LOGOUT,
    client_ip: clientIp ?? null
  })
}

export const getSessionInfo = (
  operator: OperatorContext
): SessionResponse => {
  return {
    operator: {
      id: operator.id,
      username: operator.username,
      is_root: operator.is_root,
      display_name: operator.display_name
    },
    identity: {
      id: operator.identity_id,
      type: 'user',
      name: operator.username
    }
  }
}

export const refreshToken = async (
  context: AppContext,
  operator: OperatorContext,
  oldToken: string,
  packId?: string
): Promise<LoginResponse> => {
  // 注销旧 session
  await destroySession(context, oldToken)

  // 签发新 token
  const newToken = signToken(operator)
  await createSession(context, operator.id, newToken, packId)

  return {
    token: newToken,
    operator: {
      id: operator.id,
      username: operator.username,
      is_root: operator.is_root,
      display_name: operator.display_name
    }
  }
}
