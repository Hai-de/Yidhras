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

export const runtimeSpeedOverrideRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('override'),
    step_ticks: z.union([positiveBigIntStringSchema, z.number().int().positive()])
  }),
  z.object({
    action: z.literal('clear')
  })
])

export const clockControlRequestSchema = z.object({
  action: z.enum(['pause', 'resume'])
})

export const clockControlResponseDataSchema = z.object({
  acknowledged: z.literal(true),
  status: z.enum(['paused', 'running'])
})

export const runtimeSpeedResponseDataSchema = z.object({
  runtime_speed: z.object({
    mode: z.literal('fixed'),
    source: z.enum(['default', 'world_pack', 'override']),
    configured_step_ticks: positiveBigIntStringSchema.nullable(),
    override_step_ticks: positiveBigIntStringSchema.nullable(),
    override_since: z.number().nullable(),
    effective_step_ticks: positiveBigIntStringSchema
  })
})

export type TimeFormatted = z.infer<typeof timeFormattedSchema>
