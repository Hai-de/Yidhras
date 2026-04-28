import { z } from 'zod'

export const createBackupRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional()
  })
  .strict()

export const listBackupsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0)
  })
  .strict()

export const configBackupSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    created_at: z.string(),
    size_bytes: z.number(),
    path: z.string()
  })
  .strict()

export const configBackupPolicySchema = z
  .object({
    enabled: z.boolean(),
    directory: z.string(),
    retention: z
      .object({
        max_count: z.number().int().positive(),
        max_age_days: z.number().int().positive()
      })
      .strict()
  })
  .strict()

export type CreateBackupRequest = z.infer<typeof createBackupRequestSchema>
export type ListBackupsQuery = z.infer<typeof listBackupsQuerySchema>
export type ConfigBackup = z.infer<typeof configBackupSchema>
export type ConfigBackupPolicy = z.infer<typeof configBackupPolicySchema>
