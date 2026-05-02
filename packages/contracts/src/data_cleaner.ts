import { z } from 'zod'

const nonEmptyStringSchema = z.string().trim().min(1)

export const dataCleanerInterfaceKeySchema = z
  .string()
  .regex(/^data_cleaner\.\w+$/, 'must be a data_cleaner.<name> key')

export const dataCleanerCapabilitySchema = z.object({
  key: dataCleanerInterfaceKeySchema,
  version: nonEmptyStringSchema
})

export const dataCleanerInputSchema = z.object({
  text: z.string(),
  options: z.record(z.string(), z.unknown()).optional()
})

export const dataCleanerOutputSchema = z.object({
  cleaned: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional()
})

export type DataCleanerCapability = z.infer<typeof dataCleanerCapabilitySchema>
export type DataCleanerInput = z.infer<typeof dataCleanerInputSchema>
export type DataCleanerOutput = z.infer<typeof dataCleanerOutputSchema>
