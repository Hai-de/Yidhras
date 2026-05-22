import { z } from 'zod'

import { positiveBigIntStringSchema } from './scalars.js'

export const timeFormattedSchema = z.object({
  calendar_id: z.string(),
  calendar_name: z.string(),
  display: z.string(),
  units: z.record(z.string(), z.union([z.string(), z.number()]))
})

export const clockDataSchema = z.object({
  absolute_ticks: positiveBigIntStringSchema,
  calendars: z.array(timeFormattedSchema)
})

export const clockControlRequestSchema = z.object({
  action: z.enum(['pause', 'resume'])
})

export const clockControlResponseDataSchema = z.object({
  acknowledged: z.literal(true),
  status: z.enum(['paused', 'running'])
})

export const stepStrategyRangeSchema = z.object({
  min: positiveBigIntStringSchema,
  max: positiveBigIntStringSchema
})

export const adaptiveConfigSchema = z.object({
  target_loop_ms: z.number().int().positive(),
  scale_up_threshold_ms: z.number().int().positive(),
  scale_down_threshold_ms: z.number().int().positive()
})

export const stepStrategySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('variable'),
    range: stepStrategyRangeSchema,
    loop_interval_ms: z.number().int().positive().optional()
  }),
  z.object({
    kind: z.literal('adaptive'),
    range: stepStrategyRangeSchema,
    loop_interval_ms: z.number().int().positive().optional(),
    adaptive: adaptiveConfigSchema
  })
])

export const runtimeSpeedDataSchema = z.object({
  mode: z.enum(['variable', 'adaptive']),
  source: z.enum(['default', 'world_pack', 'override']),
  strategy: stepStrategySchema,
  effective_step_ticks: positiveBigIntStringSchema,
  override_since: z.number().nullable()
})

export const runtimeSpeedResponseDataSchema = z.object({
  runtime_speed: runtimeSpeedDataSchema
})

export const runtimeSpeedOverrideRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_strategy'),
    strategy: stepStrategySchema
  }),
  z.object({
    action: z.literal('reset')
  })
])

export type TimeFormatted = z.infer<typeof timeFormattedSchema>
