import { z } from 'zod'

const relationalPositiveLimitQuerySchema = z.coerce.number().finite().int().positive()

export const atmosphereNodesQuerySchema = z.object({
  owner_id: z.string().optional(),
  include_expired: z.enum(['true', 'false']).optional()
})

export const relationshipLogsParamsSchema = z.object({
  from_id: z.string().trim().min(1),
  to_id: z.string().trim().min(1),
  type: z.string().trim().min(1)
})

export const relationshipLogsQuerySchema = z.object({
  limit: relationalPositiveLimitQuerySchema.optional()
})
