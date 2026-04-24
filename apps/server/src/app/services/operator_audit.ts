import type { AppContext } from '../context.js'

export const queryAuditLogs = async (
  context: AppContext,
  filters: {
    operator_id?: string
    pack_id?: string
    action?: string
    from_date?: string
    to_date?: string
    limit: number
    cursor?: string
  },
  isRoot: boolean,
  currentOperatorId?: string
) => {
  const where: Record<string, unknown> = {}

  // root 可见全部，普通 Operator 仅见自己
  if (!isRoot) {
    if (currentOperatorId) {
      where.operator_id = currentOperatorId
    } else {
      return { logs: [], next_cursor: null }
    }
  } else if (filters.operator_id) {
    where.operator_id = filters.operator_id
  }

  if (filters.pack_id) {
    where.pack_id = filters.pack_id
  }

  if (filters.action) {
    where.action = filters.action
  }

  if (filters.from_date) {
    where.created_at = { ...(where.created_at as Record<string, unknown> ?? {}), gte: BigInt(filters.from_date) }
  }

  if (filters.to_date) {
    where.created_at = { ...(where.created_at as Record<string, unknown> ?? {}), lte: BigInt(filters.to_date) }
  }

  // cursor 分页
  if (filters.cursor) {
    where.id = { lt: filters.cursor }
  }

  const logs = await context.prisma.operatorAuditLog.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: filters.limit + 1
  })

  const hasNext = logs.length > filters.limit
  if (hasNext) {
    logs.pop()
  }

  return {
    logs,
    next_cursor: hasNext ? logs[logs.length - 1]?.id ?? null : null
  }
}
