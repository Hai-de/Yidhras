import { z } from 'zod'

import { nonNegativeBigIntStringSchema, positiveBigIntStringSchema } from './scalars.js'

export const runtimeSpeedSnapshotSchema = z.object({
  mode: z.literal('fixed'),
  source: z.enum(['default', 'world_pack', 'override']),
  configured_step_ticks: positiveBigIntStringSchema.nullable(),
  override_step_ticks: positiveBigIntStringSchema.nullable(),
  override_since: z.number().nullable(),
  effective_step_ticks: positiveBigIntStringSchema
})

export const schedulerWorkerConfigSchema = z.object({
  worker_id: z.string(),
  partition_count: z.number().int().positive(),
  owned_partition_ids: z.array(z.string()),
  assignment_source: z.enum(['persisted', 'bootstrap', 'fallback']),
  migration_in_progress_count: z.number().int().nonnegative(),
  worker_runtime_status: z.string(),
  last_heartbeat_at: nonNegativeBigIntStringSchema.nullable(),
  automatic_rebalance_enabled: z.boolean()
})

export const runtimeStatusDataSchema = z.object({
  status: z.enum(['running', 'paused']),
  runtime_ready: z.boolean(),
  runtime_speed: runtimeSpeedSnapshotSchema,
  scheduler: schedulerWorkerConfigSchema,
  health_level: z.enum(['ok', 'degraded', 'fail']),
  world_pack: z
    .object({
      id: z.string(),
      name: z.string(),
      version: z.string()
    })
    .nullable(),
  has_error: z.boolean(),
  startup_errors: z.array(z.string())
})

export const startupHealthDataSchema = z.object({
  healthy: z.boolean(),
  level: z.enum(['ok', 'degraded', 'fail']),
  runtime_ready: z.boolean(),
  checks: z.object({
    db: z.boolean(),
    world_pack_dir: z.boolean(),
    world_pack_available: z.boolean()
  }),
  available_world_packs: z.array(z.string()),
  errors: z.array(z.string())
})

export const systemMessageSchema = z.object({
  id: z.string(),
  level: z.enum(['info', 'warning', 'error']),
  content: z.string(),
  timestamp: nonNegativeBigIntStringSchema.or(z.number()),
  code: z.string().optional(),
  details: z.unknown().optional()
})

export const acknowledgementDataSchema = z.object({
  acknowledged: z.literal(true)
})
