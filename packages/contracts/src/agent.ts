import { z } from 'zod'

export const agentIdParamsSchema = z.object({
  id: z.string().min(1)
})

const positiveAgentLimitQuerySchema = z.coerce.number().finite().int().positive()

export const agentOverviewQuerySchema = z.object({
  limit: positiveAgentLimitQuerySchema.optional()
})

export const agentSchedulerProjectionQuerySchema = z.object({
  limit: positiveAgentLimitQuerySchema.optional()
})

export const agentSnrLogsQuerySchema = z.object({
  limit: positiveAgentLimitQuerySchema.optional()
})
