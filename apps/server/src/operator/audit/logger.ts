import { Prisma } from '@prisma/client'

import { resolvePackTick } from '../../app/services/pack/pack_runtime_resolution.js';
import type { DbContext } from '../../utils/db_context.js';
import type { AuditAction } from '../constants.js'

export interface OperatorAuditEntry {
  operator_id?: string | null | undefined
  pack_id?: string | null | undefined
  action: AuditAction
  target_id?: string | null | undefined
  detail_json?: Prisma.JsonObject | null | undefined
  client_ip?: string | null | undefined
}

export const logOperatorAudit = async (
  context: DbContext,
  entry: OperatorAuditEntry
): Promise<void> => {
  const now = resolvePackTick(context)

  await context.prisma.operatorAuditLog.create({
    data: {
      operator_id: entry.operator_id ?? null,
      pack_id: entry.pack_id ?? null,
      action: entry.action,
      target_id: entry.target_id ?? null,
      detail_json: entry.detail_json === undefined || entry.detail_json === null
        ? Prisma.JsonNull
        : (entry.detail_json as Prisma.InputJsonValue),
      client_ip: entry.client_ip ?? null,
      created_at: now
    }
  })
}
