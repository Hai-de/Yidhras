import { z } from 'zod'

import { nonNegativeBigIntStringSchema } from './scalars.js'

export const socialPostRequestSchema = z.object({
  content: z.string().trim().min(1, 'content is required')
})

export const socialFeedQuerySchema = z.object({
  limit: z.string().optional(),
  author_id: z.string().optional(),
  agent_id: z.string().optional(),
  source_action_intent_id: z.string().optional(),
  from_tick: nonNegativeBigIntStringSchema.optional(),
  to_tick: nonNegativeBigIntStringSchema.optional(),
  keyword: z.string().optional(),
  circle_id: z.string().optional(),
  cursor: z.string().optional(),
  signal_min: z.string().optional(),
  signal_max: z.string().optional(),
  sort: z.enum(['latest', 'signal']).optional()
})
