import { z } from 'zod'

const nonEmptyIdParamSchema = z.string().trim().min(1)
const positiveAgentLimitQuerySchema = z.coerce.number().finite().int().positive()

export const agentIdParamsSchema = z.object({
  id: nonEmptyIdParamSchema
})

export const entityIdParamsSchema = z.object({
  id: nonEmptyIdParamSchema
})

export const agentOverviewQuerySchema = z.object({
  limit: positiveAgentLimitQuerySchema.optional()
})

export const agentSchedulerProjectionQuerySchema = z.object({
  limit: positiveAgentLimitQuerySchema.optional()
})

export const agentSnrLogsQuerySchema = z.object({
  limit: positiveAgentLimitQuerySchema.optional()
})
