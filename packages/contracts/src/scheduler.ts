import { z } from 'zod'

import { nonNegativeBigIntStringSchema } from './scalars.js'

const positiveSchedulerQueryNumberSchema = z.coerce.number().finite().int().positive()

export const schedulerKindSchema = z.enum(['periodic', 'event_driven'])

export const schedulerReasonSchema = z.enum([
  'periodic_tick',
  'bootstrap_seed',
  'event_followup',
  'relationship_change_followup',
  'snr_change_followup'
])

export const schedulerSkipReasonSchema = z.enum([
  'pending_workflow',
  'periodic_cooldown',
  'event_coalesced',
  'replay_window_periodic_suppressed',
  'replay_window_event_suppressed',
  'retry_window_periodic_suppressed',
  'retry_window_event_suppressed',
  'existing_same_idempotency',
  'limit_reached'
])

export const schedulerOwnershipStatusSchema = z.enum(['assigned', 'migrating', 'released'])

export const schedulerMigrationStatusSchema = z.enum(['requested', 'in_progress', 'completed', 'failed', 'cancelled'])

export const schedulerWorkerRuntimeStatusSchema = z.enum(['active', 'stale', 'suspected_dead'])

export const schedulerRebalanceRecommendationStatusSchema = z.enum([
  'recommended',
  'suppressed',
  'applied',
  'superseded',
  'expired'
])

export const schedulerRunsQuerySchema = z.object({
  limit: positiveSchedulerQueryNumberSchema.optional(),
  cursor: z.string().optional(),
  from_tick: nonNegativeBigIntStringSchema.optional(),
  to_tick: nonNegativeBigIntStringSchema.optional(),
  worker_id: z.string().optional(),
  partition_id: z.string().optional()
})

export const schedulerSummaryQuerySchema = z.object({
  sample_runs: positiveSchedulerQueryNumberSchema.optional()
})

export const schedulerTrendsQuerySchema = z.object({
  sample_runs: positiveSchedulerQueryNumberSchema.optional()
})

export const schedulerOperatorQuerySchema = z.object({
  sample_runs: positiveSchedulerQueryNumberSchema.optional(),
  recent_limit: positiveSchedulerQueryNumberSchema.optional()
})

export const schedulerOwnershipQuerySchema = z.object({
  worker_id: z.string().optional(),
  partition_id: z.string().optional(),
  status: schedulerOwnershipStatusSchema.optional()
})

export const schedulerMigrationsQuerySchema = z.object({
  limit: positiveSchedulerQueryNumberSchema.optional(),
  worker_id: z.string().optional(),
  partition_id: z.string().optional(),
  status: schedulerMigrationStatusSchema.optional()
})

export const schedulerWorkersQuerySchema = z.object({
  worker_id: z.string().optional(),
  status: schedulerWorkerRuntimeStatusSchema.optional()
})

export const schedulerRebalanceRecommendationsQuerySchema = z.object({
  limit: positiveSchedulerQueryNumberSchema.optional(),
  worker_id: z.string().optional(),
  partition_id: z.string().optional(),
  status: schedulerRebalanceRecommendationStatusSchema.optional(),
  suppress_reason: z.string().optional()
})

export const schedulerRunIdParamsSchema = z.object({
  id: z.string().trim().min(1)
})

export const schedulerDecisionsQuerySchema = z.object({
  limit: positiveSchedulerQueryNumberSchema.optional(),
  cursor: z.string().optional(),
  actor_id: z.string().optional(),
  kind: schedulerKindSchema.optional(),
  reason: schedulerReasonSchema.optional(),
  skipped_reason: schedulerSkipReasonSchema.optional(),
  from_tick: nonNegativeBigIntStringSchema.optional(),
  to_tick: nonNegativeBigIntStringSchema.optional(),
  partition_id: z.string().optional()
})
