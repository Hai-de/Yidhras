import { z } from 'zod'

import { nonNegativeBigIntStringSchema } from './scalars.js'

export const auditViewKindSchema = z.enum([
  'workflow',
  'post',
  'relationship_adjustment',
  'snr_adjustment',
  'event'
])

export const auditFeedQuerySchema = z.object({
  limit: z.string().optional(),
  kinds: z.union([auditViewKindSchema, z.array(auditViewKindSchema)]).optional(),
  from_tick: nonNegativeBigIntStringSchema.optional(),
  to_tick: nonNegativeBigIntStringSchema.optional(),
  job_id: z.string().optional(),
  inference_id: z.string().optional(),
  agent_id: z.string().optional(),
  action_intent_id: z.string().optional(),
  cursor: z.string().optional()
})

export const auditEntryParamsSchema = z.object({
  kind: auditViewKindSchema,
  id: z.string().min(1)
})
