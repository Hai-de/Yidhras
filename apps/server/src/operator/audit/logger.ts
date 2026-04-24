import type { Prisma } from '@prisma/client'

import type { AppContext } from '../../app/context.js'
import type { AuditAction } from '../constants.js'

export interface OperatorAuditEntry {
  operator_id?: string | null
  pack_id?: string | null
  action: AuditAction
  target_id?: string | null
  detail_json?: Prisma.JsonObject | null
  client_ip?: string | null
}

export const logOperatorAudit = async (
  context: AppContext,
  entry: OperatorAuditEntry
): Promise<void> => {
  const now = context.sim.getCurrentTick()

  await context.prisma.operatorAuditLog.create({
    data: {
      operator_id: entry.operator_id ?? null,
      pack_id: entry.pack_id ?? null,
      action: entry.action,
      target_id: entry.target_id ?? null,
      detail_json: entry.detail_json ?? undefined,
      client_ip: entry.client_ip ?? null,
      created_at: now
    }
  })
}
