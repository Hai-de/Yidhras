import { z } from 'zod'

export const policyEffectSchema = z.enum(['allow', 'deny'])

export const policyConditionScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null()
])

export const policyConditionValueSchema = z.union([
  policyConditionScalarSchema,
  z.array(policyConditionScalarSchema)
])

export const policyConditionsSchema = z
  .record(z.string(), policyConditionValueSchema)
  .superRefine((conditions, ctx) => {
    for (const key of Object.keys(conditions)) {
      if (key.trim().length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'conditions key must not be empty',
          path: [key]
        })
      }
    }
  })

export const createPolicyRequestSchema = z.object({
  effect: policyEffectSchema,
  subject_id: z.string().optional(),
  subject_type: z.string().optional(),
  resource: z.string().min(1),
  action: z.string().min(1),
  field: z.string().min(1),
  conditions: policyConditionsSchema.optional(),
  priority: z.number().int().optional()
})

export const evaluatePolicyRequestSchema = z.object({
  resource: z.string().min(1),
  action: z.string().min(1),
  fields: z.array(z.string().min(1)).min(1),
  attributes: z.record(z.string(), z.unknown()).optional()
})
