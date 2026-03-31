import { z } from 'zod'

export const apiSuccessMetaSchema = z.object({
  pagination: z
    .object({
      has_next_page: z.boolean().optional(),
      next_cursor: z.string().nullable().optional()
    })
    .optional(),
  warnings: z
    .array(
      z.object({
        code: z.string(),
        message: z.string()
      })
    )
    .optional(),
  schema_version: z.string().optional()
})

export const apiFailureSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string(),
    timestamp: z.number(),
    details: z.unknown().optional()
  })
})

export const createApiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
    meta: apiSuccessMetaSchema.optional()
  })

export const createApiEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.union([createApiSuccessSchema(dataSchema), apiFailureSchema])

export type ApiSuccessMeta = z.infer<typeof apiSuccessMetaSchema>
export type ApiFailure = z.infer<typeof apiFailureSchema>
export type ApiSuccess<T> = {
  success: true
  data: T
  meta?: ApiSuccessMeta
}
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure
