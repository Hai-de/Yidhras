import { z } from 'zod'

import { nonNegativeBigIntStringSchema } from './scalars.js'

export const inferenceStrategySchema = z.enum(['mock', 'rule_based'])
export const inferenceJobStatusSchema = z.enum(['pending', 'running', 'completed', 'failed'])

export const inferenceRequestSchema = z.object({
  agent_id: z.string().optional(),
  identity_id: z.string().optional(),
  strategy: inferenceStrategySchema.optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  idempotency_key: z.string().optional()
})

export const inferenceJobReplayRequestSchema = z.object({
  reason: z.string().optional(),
  idempotency_key: z.string().optional(),
  overrides: z
    .object({
      strategy: inferenceStrategySchema.optional(),
      attributes: z.record(z.string(), z.unknown()).optional(),
      agent_id: z.string().optional(),
      identity_id: z.string().optional()
    })
    .optional()
})

export const inferenceJobIdParamsSchema = z.object({
  id: z.string().min(1)
})

export const inferenceJobsQuerySchema = z.object({
  status: z.union([inferenceJobStatusSchema, z.array(inferenceJobStatusSchema)]).optional(),
  agent_id: z.string().optional(),
  identity_id: z.string().optional(),
  strategy: inferenceStrategySchema.optional(),
  job_type: z.string().optional(),
  from_tick: nonNegativeBigIntStringSchema.optional(),
  to_tick: nonNegativeBigIntStringSchema.optional(),
  from_created_at: nonNegativeBigIntStringSchema.optional(),
  to_created_at: nonNegativeBigIntStringSchema.optional(),
  cursor: z.string().optional(),
  limit: z.string().optional(),
  has_error: z.enum(['true', 'false']).optional(),
  action_intent_id: z.string().optional()
})
