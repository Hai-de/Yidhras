import { z } from 'zod'

export const policyEffectSchema = z.enum(['allow', 'deny'])

export const createPolicyRequestSchema = z.object({
  effect: policyEffectSchema,
  subject_id: z.string().optional(),
  subject_type: z.string().optional(),
  resource: z.string().min(1),
  action: z.string().min(1),
  field: z.string().min(1),
  conditions: z.unknown().optional(),
  priority: z.number().int().optional()
})

export const evaluatePolicyRequestSchema = z.object({
  resource: z.string().min(1),
  action: z.string().min(1),
  fields: z.array(z.string().min(1)).min(1),
  attributes: z.record(z.string(), z.unknown()).optional()
})
