import { z } from 'zod'

export const packActionRequestSchema = z.object({
  capability_key: z.string().min(1, 'capability_key is required'),
  payload: z.unknown().default({})
})

export type PackActionRequest = z.infer<typeof packActionRequestSchema>

export const packActionPerceiveDataSchema = z.object({
  capability_key: z.string(),
  data: z.unknown()
})

export type PackActionPerceiveData = z.infer<typeof packActionPerceiveDataSchema>

export const packActionInvokeDataSchema = z.object({
  capability_key: z.string(),
  intent_id: z.string()
})

export type PackActionInvokeData = z.infer<typeof packActionInvokeDataSchema>
