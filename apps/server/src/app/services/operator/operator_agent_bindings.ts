import { logOperatorAudit } from '../../../operator/audit/logger.js'
import { AUDIT_ACTION } from '../../../operator/constants.js'
import { ApiError } from '../../../utils/api_error.js'
import type { DbContext } from '../../../utils/db_context.js'
import { resolvePackTick } from '../pack/pack_runtime_resolution.js';

export const createAgentBinding = async (
  context: DbContext,
  agentId: string,
  operatorIdentityId: string,
  role: string,
  boundByOperatorId?: string,
  clientIp?: string
) => {
  const existing = await context.prisma.identityNodeBinding.findFirst({
    where: {
      identity_id: operatorIdentityId,
      agent_id: agentId,
      status: 'active'
    }
  })

  if (existing) {
    throw new ApiError(409, 'BINDING_ALREADY_EXISTS', 'Agent binding already exists for this operator')
  }

  const now = resolvePackTick(context)

  const binding = await context.prisma.identityNodeBinding.create({
    data: {
      identity_id: operatorIdentityId,
      agent_id: agentId,
      role,
      status: 'active',
      created_at: now,
      updated_at: now
    }
  })

  await logOperatorAudit(context as never, {
    operator_id: boundByOperatorId ?? null,
    pack_id: null,
    action: AUDIT_ACTION.BIND_AGENT,
    target_id: agentId,
    detail_json: { identity_id: operatorIdentityId, role },
    client_ip: clientIp ?? null
  })

  return binding
}

export const unbindAgent = async (
  context: DbContext,
  agentId: string,
  operatorIdentityId: string,
  operatorId?: string,
  clientIp?: string
) => {
  const binding = await context.prisma.identityNodeBinding.findFirst({
    where: {
      identity_id: operatorIdentityId,
      agent_id: agentId,
      status: 'active'
    }
  })

  if (!binding) {
    throw new ApiError(404, 'BINDING_NOT_FOUND', 'Agent binding not found')
  }

  const now = resolvePackTick(context)

  await context.prisma.identityNodeBinding.update({
    where: { id: binding.id },
    data: {
      status: 'inactive',
      updated_at: now
    }
  })

  await logOperatorAudit(context as never, {
    operator_id: operatorId ?? null,
    action: AUDIT_ACTION.UNBIND_AGENT,
    target_id: agentId,
    client_ip: clientIp ?? null
  })

  return { unbound: true }
}

export const listAgentOperators = async (
  context: DbContext,
  agentId: string
) => {
  const bindings = await context.prisma.identityNodeBinding.findMany({
    where: {
      agent_id: agentId,
      status: 'active'
    },
    include: {
      identity: true
    },
    orderBy: { created_at: 'desc' }
  })

  return bindings.filter(b => b.identity.type === 'user').map(b => ({
    binding_id: b.id,
    identity_id: b.identity_id,
    identity_name: b.identity.name,
    role: b.role,
    created_at: b.created_at
  }))
}
